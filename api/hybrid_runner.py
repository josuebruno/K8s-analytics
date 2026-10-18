"""Persistent two-stage Kubernetes orchestrator.

State is stored on NFS. Both the HTTP endpoint and a Kubernetes CronJob can
reconcile running executions; exclusive per-run locking prevents concurrent
reconciliation and duplicate submissions.
"""
import fcntl
import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, Field

ROOT = Path(os.environ.get('SHARED_ROOT', '/shared')) / 'hybrid-runs'
NAMESPACE = 'analytics-jobs'
IMAGES = {
    'python': 'harbor.ipea.gov.br/desenvolvimento/analytics-worker-python:2.0',
    'r': 'harbor.ipea.gov.br/desenvolvimento/analytics-worker-r:2.0',
}


class HybridRunRequest(BaseModel):
    run_name: str = Field(default='Execução híbrida', max_length=120)
    python_code: str = Field(min_length=1, max_length=500000)
    r_code: str = Field(min_length=1, max_length=500000)
    execution_mode: str = 'parallel'
    ram_limit_gb: int = Field(default=2, ge=1, le=4)
    cpus: int = Field(default=1, ge=1, le=2)
    ephemeral_storage_gb: int = Field(default=1, ge=1, le=4)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _run(command, stdin=None):
    try:
        return subprocess.run(command, input=stdin, text=True, capture_output=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, 'Timeout ao comunicar com Kubernetes')


def _save(folder, data):
    tmp = folder / ('state.' + uuid.uuid4().hex + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(folder / 'state.json')


def _job_spec(job_id, lang, folder, req):
    output = str(folder / lang)
    args = ['--code-file', str(folder / ('main.py' if lang == 'python' else 'main.R')),
            '--ram-limit-gb', str(req['ram_limit_gb']), '--cpus', str(req['cpus']),
            '--output-dir', output]
    resources = {
        'requests': {'cpu': str(req['cpus']), 'memory': f"{req['ram_limit_gb']}Gi", 'ephemeral-storage': f"{req['ephemeral_storage_gb']}Gi"},
        'limits': {'cpu': str(req['cpus']), 'memory': f"{req['ram_limit_gb']}Gi", 'ephemeral-storage': f"{req['ephemeral_storage_gb']}Gi"},
    }
    return {
        'apiVersion': 'batch/v1', 'kind': 'Job',
        'metadata': {'name': job_id, 'namespace': NAMESPACE,
                     'labels': {'app': 'analytics-worker', 'language': lang, 'run-type': 'hybrid'}},
        'spec': {'backoffLimit': 0, 'ttlSecondsAfterFinished': 86400,
                 'template': {'metadata': {'labels': {'app': 'analytics-worker', 'language': lang}},
                              'spec': {'restartPolicy': 'Never', 'automountServiceAccountToken': False,
                                       'imagePullSecrets': [{'name': 'harbor-analytics'}],
                                       'nodeSelector': {'analytics-worker': 'true'},
                                       'containers': [{'name': 'worker', 'image': IMAGES[lang],
                                                       'imagePullPolicy': 'IfNotPresent',
                                                       'args': args, 'resources': resources,
                                                       'volumeMounts': [{'name': 'shared-data', 'mountPath': '/shared'}]}],
                                       'volumes': [{'name': 'shared-data', 'persistentVolumeClaim': {'claimName': 'analytics-shared-pvc'}}]}}}
    }


def _submit(folder, state, lang):
    stage = state['stages'][lang]
    if stage['status'] != 'pending':
        return
    spec = _job_spec(stage['job_name'], lang, folder, state['resources'])
    result = _run(['kubectl', 'create', '-f', '-'], json.dumps(spec))
    if result.returncode != 0:
        stage['status'] = 'failed'
        stage['error'] = (result.stderr or result.stdout)[-1500:]
    else:
        stage['status'] = 'submitted'
        stage['submitted_at'] = _now()


def _reconcile_stage(folder, stage):
    if stage['status'] not in ('submitted', 'running'):
        return
    result_file = folder / stage['language'] / 'result.json'
    if result_file.is_file():
        try:
            result = json.loads(result_file.read_text(encoding='utf-8'))
            stage['result'] = result
            stage['status'] = 'completed' if result.get('status') == 'success' and result.get('returncode', 1) == 0 else 'failed'
            return
        except (OSError, json.JSONDecodeError):
            pass
    res = _run(['kubectl', 'get', 'job', stage['job_name'], '-n', NAMESPACE, '-o', 'json'])
    if res.returncode != 0:
        stage['status'] = 'failed'
        stage['error'] = 'Job não encontrado; verifique TTL e eventos do cluster'
        return
    payload = json.loads(res.stdout)
    status = payload.get('status') or {}
    if status.get('failed', 0) > 0:
        stage['status'] = 'failed'
        stage['error'] = 'Job falhou; consulte logs e stderr'
    elif status.get('succeeded', 0) > 0:
        stage['status'] = 'completed' if result_file.exists() else 'failed'
        if not result_file.exists():
            stage['error'] = 'Job concluído sem result.json'
    elif status.get('active', 0) > 0:
        stage['status'] = 'running'


def _authorize(state, user):
    if not user.get('is_admin') and state['user_id'] != user['id']:
        raise HTTPException(404, 'Execução não encontrada')


def create_hybrid(req, user):
    if req.execution_mode not in ('parallel', 'python_then_r', 'r_then_python'):
        raise HTTPException(400, 'execution_mode inválido')
    run_id = uuid.uuid4().hex
    folder = ROOT / run_id
    folder.mkdir(parents=True, mode=0o700, exist_ok=False)
    (folder / 'main.py').write_text(req.python_code, encoding='utf-8')
    (folder / 'main.R').write_text(req.r_code, encoding='utf-8')
    for lang in ('python', 'r'):
        (folder / lang).mkdir()
    order = ['python', 'r'] if req.execution_mode != 'r_then_python' else ['r', 'python']
    state = {'run_id': run_id, 'user_id': user['id'], 'run_name': req.run_name,
             'execution_mode': req.execution_mode, 'created_at': _now(), 'status': 'running',
             'resources': {'ram_limit_gb': req.ram_limit_gb, 'cpus': req.cpus,
                           'ephemeral_storage_gb': req.ephemeral_storage_gb},
             'order': order,
             'stages': {lang: {'language': lang, 'job_name': f'hyb-{run_id[:16]}-{lang}',
                               'status': 'pending', 'output_dir': str(folder / lang)} for lang in ('python', 'r')}}
    for lang in (order if req.execution_mode == 'parallel' else order[:1]):
        _submit(folder, state, lang)
    if any(s['status'] == 'failed' for s in state['stages'].values()):
        state['status'] = 'failed'
    _save(folder, state)
    return _public(state)


def _public(state):
    safe = dict(state)
    safe.pop('user_id', None)
    return safe


def _reconcile_locked(folder, state):
    """Advance one run while the caller holds state.lock."""
    if state['status'] != 'running':
        return state
    for stage in state['stages'].values():
        _reconcile_stage(folder, stage)
    order = state['order']
    if state['execution_mode'] != 'parallel':
        first, second = order
        if state['stages'][first]['status'] == 'completed':
            _submit(folder, state, second)
        elif state['stages'][first]['status'] == 'failed':
            state['stages'][second]['status'] = 'skipped'
    statuses = [stage['status'] for stage in state['stages'].values()]
    if all(status == 'completed' for status in statuses):
        state['status'] = 'completed'
    elif any(status == 'failed' for status in statuses) and all(
        status in ('completed', 'failed', 'skipped') for status in statuses
    ):
        state['status'] = 'failed'
    state['updated_at'] = _now()
    _save(folder, state)
    return state


def get_hybrid(run_id, user):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id):
        raise HTTPException(404, 'Execução não encontrada')
    folder = ROOT / run_id
    if not (folder / 'state.json').is_file():
        raise HTTPException(404, 'Execução não encontrada')
    with (folder / 'state.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = json.loads((folder / 'state.json').read_text(encoding='utf-8'))
        _authorize(state, user)
        return _public(_reconcile_locked(folder, state))


def reconcile_all(max_runs=1000):
    """Reconcile active runs independently of frontend polling.

    Called by Kubernetes CronJob; a per-run filesystem lock serializes it
    against HTTP polling and against any overlapping reconciliation.
    """
    if not ROOT.is_dir():
        return {'checked': 0, 'updated': 0, 'errors': []}
    checked = 0
    updated = 0
    errors = []
    for folder in sorted(ROOT.iterdir()):
        if checked >= max_runs:
            break
        if not folder.is_dir() or not re.fullmatch(r'[a-f0-9]{32}', folder.name):
            continue
        state_file = folder / 'state.json'
        if not state_file.is_file():
            continue
        checked += 1
        try:
            with (folder / 'state.lock').open('a+') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                state = json.loads(state_file.read_text(encoding='utf-8'))
                if state.get('status') == 'running':
                    _reconcile_locked(folder, state)
                    updated += 1
        except Exception as exc:
            errors.append({'run_id': folder.name, 'error': str(exc)[:250]})
    return {'checked': checked, 'updated': updated, 'errors': errors}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Analytics hybrid reconciliation')
    parser.add_argument('action', choices=['reconcile-all'])
    parser.add_argument('--max-runs', type=int, default=1000)
    args = parser.parse_args()
    if args.max_runs < 1:
        parser.error('--max-runs precisa ser maior que zero')
    result = reconcile_all(max_runs=args.max_runs)
    print(json.dumps(result, ensure_ascii=False))
    if result['errors']:
        raise SystemExit(1)
