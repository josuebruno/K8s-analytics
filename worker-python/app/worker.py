import json
import time
import argparse
import mimetypes
import subprocess
import sys
import os
from pathlib import Path

import pandas as pd


def emit(event_type, message=None, value=None, extra=None):
    payload = {"type": event_type}
    if message is not None:
        payload["message"] = message
    if value is not None:
        payload["value"] = value
    if extra is not None:
        payload["extra"] = extra
    print(json.dumps(payload), flush=True)


def fail(message, code=1):
    emit("error", message=message)
    raise SystemExit(code)


def list_artifacts(artifacts_dir: Path):
    items = []
    if not artifacts_dir.exists():
        return items

    for p in sorted(artifacts_dir.rglob("*")):
        if p.is_file():
            mime, _ = mimetypes.guess_type(str(p))
            items.append({
                "name": p.name,
                "path": str(p),
                "relative_path": str(p.relative_to(artifacts_dir)),
                "type": mime or "application/octet-stream",
                "size_bytes": p.stat().st_size
            })
    return items


def load_dataframe(data_format, data_path):
    fmt = data_format.lower().strip()
    path = Path(data_path)

    if not path.exists():
        fail(f"Arquivo não encontrado: {data_path}")

    emit("log", message=f"Lendo arquivo no formato {fmt}: {data_path}")
    emit("progress", value=15, message="Iniciando leitura da base")

    if fmt == "csv":
        df = pd.read_csv(path)
    elif fmt == "parquet":
        df = pd.read_parquet(path)
    elif fmt == "json":
        df = pd.read_json(path)
    elif fmt in ("xlsx", "excel"):
        df = pd.read_excel(path)
    else:
        fail(f"Formato não suportado neste MVP: {data_format}")

    emit("progress", value=55, message="Base carregada em memória")
    return df


def write_json(path: Path, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def execute_user_code(code_file: Path, output_dir: Path):
    if not code_file.exists():
        fail(f"Código não encontrado: {code_file}")

    artifacts_dir = output_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    emit("log", message=f"Executando código do usuário: {code_file}")
    emit("progress", value=20, message="Iniciando execução do código")

    env = os.environ.copy()
    env["OUTPUT_DIR"] = str(output_dir)
    env["ARTIFACTS_DIR"] = str(artifacts_dir)

    proc = subprocess.run(
        [sys.executable, str(code_file)],
        cwd=str(code_file.parent),
        env=env,
        capture_output=True,
        text=True
    )

    (output_dir / "stdout.log").write_text(proc.stdout, encoding="utf-8")
    (output_dir / "stderr.log").write_text(proc.stderr, encoding="utf-8")

    artifacts = list_artifacts(artifacts_dir)

    result = {
        "status": "success" if proc.returncode == 0 else "failed",
        "mode": "inline_code_execution",
        "returncode": proc.returncode,
        "stdout_log": str(output_dir / "stdout.log"),
        "stderr_log": str(output_dir / "stderr.log"),
        "artifacts": artifacts,
        "stdout_preview": proc.stdout[:2000],
        "stderr_preview": proc.stderr[:2000]
    }

    write_json(output_dir / "result.json", result)

    emit("log", message=f"stdout salvo em {output_dir / 'stdout.log'}")
    emit("log", message=f"stderr salvo em {output_dir / 'stderr.log'}")
    emit("log", message=f"Artefatos encontrados: {len(artifacts)}")
    emit("progress", value=100, message="Execução do código concluída")
    emit("result", message="Execução finalizada", extra={"result_file": str(output_dir / 'result.json')})

    if proc.returncode != 0:
        fail("Código do usuário terminou com erro", proc.returncode)


def main():
    parser = argparse.ArgumentParser(description="Worker analítico Python")
    parser.add_argument("--data-format", required=False, default=None)
    parser.add_argument("--data-path", required=False, default=None)
    parser.add_argument("--ram-limit-gb", required=False, default="2")
    parser.add_argument("--cpus", required=False, default="1")
    parser.add_argument("--output-dir", required=False, default="/output")
    parser.add_argument("--code-file", required=False, default=None)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    emit("log", message="Worker Python iniciado")
    emit(
        "log",
        message="Parâmetros recebidos",
        extra={
            "data_format": args.data_format,
            "data_path": args.data_path,
            "ram_limit_gb": args.ram_limit_gb,
            "cpus": args.cpus,
            "output_dir": str(output_dir),
            "code_file": args.code_file
        },
    )

    time.sleep(1)

    if args.code_file:
        execute_user_code(Path(args.code_file), output_dir)
        return

    if args.data_path and args.data_format:
        df = load_dataframe(args.data_format, args.data_path)

        emit("progress", value=75, message="Processando estatísticas")
        time.sleep(1)

        result = {
            "status": "success",
            "mode": "with_data_source",
            "rows": int(df.shape[0]),
            "columns": int(df.shape[1]),
            "column_names": list(df.columns),
            "memory_usage_bytes": int(df.memory_usage(deep=True).sum()),
            "preview": df.head(10).to_dict(orient="records"),
            "artifacts": []
        }
    else:
        emit("log", message="Execução sem base de dados")
        emit("progress", value=50, message="Executando rotina sem data source")
        time.sleep(1)

        result = {
            "status": "success",
            "mode": "no_data_source",
            "message": "Execução concluída sem carregar base",
            "rows": 0,
            "columns": 0,
            "column_names": [],
            "memory_usage_bytes": 0,
            "preview": [],
            "artifacts": []
        }

    write_json(output_dir / "result.json", result)

    emit("log", message=f"Resultado salvo em {output_dir / 'result.json'}")
    emit("progress", value=100, message="Processamento concluído")
    emit("result", message="Execução finalizada", extra={"result_file": str(output_dir / 'result.json')})


if __name__ == "__main__":
    main()
