"""Adaptador kubectl do Task Engine. CREATE desabilitado por padrão.

Não instala bibliotecas; emprega ServiceAccount do Pod.
A classe mantém o contrato esperado por task_engine_submission.py.
"""
import json
import os
import re
import subprocess
from copy import deepcopy
from decimal import Decimal, InvalidOperation

NAMESPACE = 'analytics-jobs'
JOB_NAME_RE = re.compile(r'^te-[a-f0-9]{32}-a(?:0|[1-9][0-9]{0,5})$')

QUANTITY_RE = re.compile(
    r'^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti|Pi|Ei|'
    r'n|u|m|k|M|G|T|P|E)?$'
)

DECIMAL_UNITS = {
    'n': Decimal('0.000000001'),
    'u': Decimal('0.000001'),
    'm': Decimal('0.001'),
    '': Decimal(1),
    'k': Decimal(1000),
    'M': Decimal(1000) ** 2,
    'G': Decimal(1000) ** 3,
    'T': Decimal(1000) ** 4,
    'P': Decimal(1000) ** 5,
    'E': Decimal(1000) ** 6,
}

BINARY_UNITS = {
    'Ki': Decimal(1024),
    'Mi': Decimal(1024) ** 2,
    'Gi': Decimal(1024) ** 3,
    'Ti': Decimal(1024) ** 4,
    'Pi': Decimal(1024) ** 5,
    'Ei': Decimal(1024) ** 6,
}


class KubernetesError(RuntimeError):
    pass


def _execute(args, namespace=NAMESPACE, payload=None, timeout=30):
    if namespace != NAMESPACE:
        raise ValueError('Namespace não permitido')
    command = ['/usr/local/bin/kubectl', '-n', namespace, *args]
    try:
        proc = subprocess.run(
            command,
            input=payload,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise KubernetesError(
            'Falha de transporte/timeout kubectl'
        ) from exc

    if proc.returncode:
        err = proc.stderr.strip()[:1200]

        # Somente respostas inequívocas 404/409
        # são consideradas definitivas.
        if '(NotFound)' in err:
            from task_engine_submission import JobNotFound
            raise JobNotFound(err)

        if '(AlreadyExists)' in err:
            from task_engine_submission import JobAlreadyExists
            raise JobAlreadyExists(err)

        raise KubernetesError('kubectl falhou: ' + err)

    return proc.stdout


def normalize_resource_quantity(resource, value):
    """Normaliza quantidades Kubernetes sem perda de precisão.

    CPU:
        0.25 == 250m
        1 == 1000m

    Memória e armazenamento:
        0.5Gi == 512Mi
        1Gi == 1024Mi

    Recursos desconhecidos não são normalizados:
    devem permanecer literalmente idênticos.
    """
    if not isinstance(value, str):
        return None

    match = QUANTITY_RE.fullmatch(value)
    if match is None:
        return None

    try:
        number = Decimal(match.group(1))
    except InvalidOperation:
        return None

    suffix = match.group(2) or ''

    if resource == 'cpu':
        if suffix not in ('', 'm', 'u', 'n'):
            return None

        return number * DECIMAL_UNITS[suffix]

    if resource in ('memory', 'ephemeral-storage'):
        if suffix in BINARY_UNITS:
            return number * BINARY_UNITS[suffix]

        if suffix in DECIMAL_UNITS:
            return number * DECIMAL_UNITS[suffix]

        return None

    return None


def resource_dict_equal(expected, actual):
    """Compara requests/limits por quantidade real.

    Preserva:
      - Mesmas seções
      - Mesmos recursos em cada seção
      - Mesmas quantidades após normalização
      - Rejeição de valores inválidos

    Recursos desconhecidos exigem igualdade literal,
    evitando aceitar conversões não implementadas.
    """
    if not isinstance(expected, dict):
        return False

    if not isinstance(actual, dict):
        return False

    if set(expected) != set(actual):
        return False

    for section in expected:
        left = expected[section]
        right = actual[section]

        if not isinstance(left, dict):
            return False

        if not isinstance(right, dict):
            return False

        if set(left) != set(right):
            return False

        for resource in left:
            expected_value = left[resource]
            actual_value = right[resource]

            if not isinstance(expected_value, str):
                return False

            if not isinstance(actual_value, str):
                return False

            if resource not in (
                'cpu',
                'memory',
                'ephemeral-storage',
            ):
                if expected_value != actual_value:
                    return False
                continue

            normalized_expected = normalize_resource_quantity(
                resource,
                expected_value,
            )

            normalized_actual = normalize_resource_quantity(
                resource,
                actual_value,
            )

            if normalized_expected is None:
                return False

            if normalized_actual is None:
                return False

            if normalized_expected != normalized_actual:
                return False

    return True


def validate_job_identity(job, manifest):
    """Confere identidade da Task e contrato imutável relevante do Pod."""
    if not isinstance(job, dict):
        raise KubernetesError('Job inválido')

    actual = job.get('metadata') or {}
    expected = manifest['metadata']

    if (
        actual.get('name') != expected['name']
        or actual.get('namespace') != NAMESPACE
    ):
        raise KubernetesError('Nome/namespace divergente')

    for field in ('labels', 'annotations'):
        for key, val in expected.get(field, {}).items():
            if (actual.get(field) or {}).get(key) != val:
                raise KubernetesError(f'{field}.{key} divergente')

    expected_pod = manifest['spec']['template']['spec']
    got_pod = (
        (job.get('spec') or {})
        .get('template', {})
        .get('spec', {})
    )

    for field in (
        'restartPolicy',
        'automountServiceAccountToken',
        'nodeSelector',
        'imagePullSecrets',
        'volumes',
        'securityContext',
    ):
        if got_pod.get(field) != expected_pod.get(field):
            raise KubernetesError(f'Pod {field} divergente')

    expected_containers = expected_pod['containers']
    got_containers = got_pod.get('containers') or []

    if len(got_containers) != len(expected_containers):
        raise KubernetesError(
            'Quantidade de containers divergente'
        )

    for expected_c, got_c in zip(
        expected_containers,
        got_containers,
    ):
        for field in (
            'name',
            'image',
            'args',
            'volumeMounts',
            'securityContext',
        ):
            if got_c.get(field) != expected_c.get(field):
                raise KubernetesError(
                    f'Container {field} divergente'
                )

        def normalize_env(entries):
            if not isinstance(entries, list):
                return entries

            normalized = deepcopy(entries)

            for entry in normalized:
                field_ref = (
                    entry.get('valueFrom') or {}
                ).get('fieldRef')

                if isinstance(field_ref, dict):
                    field_ref.setdefault('apiVersion', 'v1')

            return normalized

        if normalize_env(
            got_c.get('env')
        ) != normalize_env(
            expected_c.get('env')
        ):
            raise KubernetesError(
                'Container env divergente'
            )

        if not resource_dict_equal(
            expected_c.get('resources'),
            got_c.get('resources'),
        ):
            raise KubernetesError(
                'Container resources divergente'
            )

    return True


class KubectlJobClient:
    def __init__(self, allow_create=False):
        # Duplo opt-in: código explícito e variável de ambiente no processo.
        self.allow_create = bool(allow_create)

    def get_job(self, namespace, name):
        if (
            namespace != NAMESPACE
            or not JOB_NAME_RE.fullmatch(name)
        ):
            raise ValueError(
                'Namespace ou nome de Job inválido'
            )

        raw = _execute(
            ['get', 'job', name, '-o', 'json'],
            namespace,
        )

        try:
            result = json.loads(raw)
        except ValueError as exc:
            raise KubernetesError(
                'Resposta inválida do Kubernetes'
            ) from exc

        if result.get('kind') != 'Job':
            raise KubernetesError('Resposta não é um Job')

        return result

    def create_job(self, namespace, manifest):
        if (
            not self.allow_create
            or os.environ.get('TASK_ENGINE_ALLOW_CREATE') != '1'
        ):
            raise KubernetesError(
                'CREATE desabilitado: requer opt-in explícito'
            )

        if (
            namespace != NAMESPACE
            or manifest.get('metadata', {}).get('namespace')
            != NAMESPACE
        ):
            raise ValueError('Namespace divergente')

        name = manifest['metadata']['name']

        if not JOB_NAME_RE.fullmatch(name):
            raise ValueError('Nome inválido')

        # Requer anotação de identidade presente
        # ANTES de permitir CREATE.
        annotations = (
            manifest['metadata'].get('annotations') or {}
        )

        for field in ('task-id', 'workflow-run-id'):
            if not annotations.get(
                'task-engine.ipea.gov.br/' + field
            ):
                raise ValueError(
                    'Anotações de identidade incompletas'
                )

        raw = _execute(
            ['create', '-f', '-', '-o', 'json'],
            namespace,
            payload=json.dumps(manifest),
        )

        result = json.loads(raw)

        validate_job_identity(result, manifest)

        return result


def validate_manifest_server(manifest):
    raw = _execute(
        [
            'create',
            '--dry-run=server',
            '--validate=strict',
            '-f',
            '-',
            '-o',
            'name',
        ],
        payload=json.dumps(manifest),
    )

    expected = (
        'job.batch/' + manifest['metadata']['name']
    )

    if expected not in raw.splitlines():
        raise KubernetesError(
            'Resposta de dry-run inesperada'
        )

    return raw.strip()


def inspect_cluster():
    raw = _execute(
        [
            'get',
            'jobs',
            '-l',
            'run-type=task-engine',
            '-o',
            'json',
        ]
    )

    return json.loads(raw).get('items', [])


if __name__ == '__main__':
    from task_engine_executor import build_job_manifest
    from task_engine_submission import _identify, JobNotFound
    import uuid

    run_id = uuid.UUID(
        '11111111-1111-4111-8111-111111111111'
    )

    task_id = uuid.UUID(
        '22222222-2222-4222-8222-222222222222'
    )

    manifest = _identify(
        build_job_manifest(
            run_id,
            task_id,
            'task_a',
            'python',
        ),
        task_id,
        run_id,
    )

    print(
        '[OK] Dry-run:',
        validate_manifest_server(manifest),
    )

    try:
        KubectlJobClient().get_job(
            NAMESPACE,
            manifest['metadata']['name'],
        )
        print(
            '[INFO] Job existente: verificar '
            'identidade antes de prosseguir'
        )
    except JobNotFound:
        print(
            '[OK] Job de demonstração não existe'
        )

    print(
        '[OK] Jobs Task Engine visíveis:',
        len(inspect_cluster()),
    )

    print('[OK] CREATE permanece desabilitado')
