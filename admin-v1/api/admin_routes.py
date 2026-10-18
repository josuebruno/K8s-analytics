"""Read-only administrative observability endpoints for Kubernetes Analytics."""
import json
import subprocess
from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix='/admin', tags=['Admin Observatory'])


def authorize(request):
    user = getattr(request.state, 'user', None)
    if not user:
        raise HTTPException(status_code=401, detail='Sessão inválida')
    if user.get('is_admin') is not True:
        raise HTTPException(status_code=403, detail='Acesso reservado a administradores')
    return user


def db():
    # Runtime import avoids a circular import while main.py registers routers.
    from main import get_db_connection
    return get_db_connection()


def kube_json(*args):
    try:
        result = subprocess.run(['kubectl', *args, '-o', 'json'], text=True,
                                capture_output=True, timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HTTPException(status_code=503, detail=f'Kubernetes indisponível: {exc}')
    if result.returncode:
        raise HTTPException(status_code=503, detail='Falha ao consultar a API do Kubernetes')
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise HTTPException(status_code=503, detail='Resposta inválida do Kubernetes')


@router.get('/overview')
def overview(request: Request):
    authorize(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute('SELECT status, COUNT(*) FROM job_runs WHERE deleted_at IS NULL GROUP BY status')
        by_status = {str(status): count for status, count in cur.fetchall()}
        cur.execute('SELECT language, COUNT(*) FROM job_runs WHERE deleted_at IS NULL GROUP BY language')
        by_language = {str(language): count for language, count in cur.fetchall()}
        cur.execute('''SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at)))
                       FROM job_runs WHERE deleted_at IS NULL
                       AND status = 'completed' AND finished_at IS NOT NULL''')
        average = cur.fetchone()[0]
        cur.execute('''SELECT COUNT(DISTINCT user_id) FROM job_runs
                       WHERE deleted_at IS NULL AND user_id IS NOT NULL''')
        users = cur.fetchone()[0]
    return {'success': True, 'total': sum(by_status.values()), 'by_status': by_status,
            'by_language': by_language, 'average_duration_seconds': round(float(average or 0), 1),
            'users_with_executions': users}


@router.get('/jobs')
def jobs(request: Request, status: str | None = None, language: str | None = None,
         q: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    authorize(request)
    where = ['r.deleted_at IS NULL']
    values = []
    if status:
        where.append('r.status = %s')
        values.append(status)
    if language:
        where.append('r.language = %s')
        values.append(language)
    if q:
        where.append('(r.job_name ILIKE %s OR r.run_name ILIKE %s OR u.username ILIKE %s)')
        values.extend([f'%{q}%'] * 3)
    clause = ' AND '.join(where)
    with db() as conn, conn.cursor() as cur:
        cur.execute(f'''SELECT COUNT(*) FROM job_runs r LEFT JOIN users u ON u.id=r.user_id
                         WHERE {clause}''', values)
        total = cur.fetchone()[0]
        cur.execute(f'''SELECT r.id, r.job_name, r.run_name, r.language, r.status,
                              r.node_name, r.started_at, r.finished_at,
                              u.username, r.cpu_request, r.memory_limit
                       FROM job_runs r LEFT JOIN users u ON u.id=r.user_id
                       WHERE {clause} ORDER BY r.id DESC LIMIT %s OFFSET %s''',
                    values + [page_size, (page-1)*page_size])
        rows = cur.fetchall()
    return {'success': True, 'total': total, 'page': page, 'page_size': page_size,
            'items': [{'id': r[0], 'job_name': r[1], 'run_name': r[2], 'language': r[3],
                       'status': r[4], 'node_name': r[5], 'started_at': r[6].isoformat() if r[6] else None,
                       'finished_at': r[7].isoformat() if r[7] else None,
                       'username': r[8], 'cpu_request': r[9], 'memory_limit': r[10]}
                      for r in rows]}


@router.get('/workers')
def workers(request: Request):
    authorize(request)
    nodes = kube_json('get', 'nodes').get('items', [])
    response = []
    for node in nodes:
        name = node.get('metadata', {}).get('name', 'unknown')
        conditions = node.get('status', {}).get('conditions', [])
        ready = next((c.get('status') == 'True' for c in conditions if c.get('type') == 'Ready'), False)
        labels = node.get('metadata', {}).get('labels', {})
        capacity = node.get('status', {}).get('allocatable', {})
        response.append({'name': name, 'ready': ready,
                         'analytics_worker': labels.get('analytics-worker') == 'true',
                         'cpu_allocatable': capacity.get('cpu'),
                         'memory_allocatable': capacity.get('memory')})
    return {'success': True, 'items': response, 'metrics_available': False}


@router.get('/health')
def health(request: Request):
    authorize(request)
    with db() as conn, conn.cursor() as cur:
        cur.execute('SELECT 1')
        cur.fetchone()
    try:
        workers = kube_json('get', 'nodes').get('items', [])
        kubernetes = 'ok'
    except HTTPException:
        workers = []
        kubernetes = 'unavailable'
    return {'success': True, 'database': 'ok', 'kubernetes': kubernetes,
            'nodes_seen': len(workers), 'metrics_available': False}


def register_admin_routes(app):
    app.include_router(router)
