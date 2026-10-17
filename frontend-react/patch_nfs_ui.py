from pathlib import Path
import sys

app = Path("/opt/analytics/frontend-react/src/App.jsx")

old = """    } else if (baseType === "nfs") {
      connection_json = {
        server: baseNfsServer,
        export_path: baseNfsExport,
        path: baseNfsPath,
        version: baseNfsVersion,
        vault_vars: baseNfsVaultVars.trim() ? JSON.parse(baseNfsVaultVars) : {},
      };
"""

new = """    } else if (baseType === "nfs") {
      connection_json = {
        server: baseNfsServer.trim(),
        export_path: baseNfsExport.trim(),
        mount_mode: "input_file",
        path: baseNfsPath.trim(),
        version: (baseNfsVersion || "4.1").trim(),
        vault_vars: baseNfsVaultVars.trim() ? JSON.parse(baseNfsVaultVars) : {},
      };
"""

text = app.read_text(encoding="utf-8")

if old not in text:
    print("Bloco original NFS não encontrado em App.jsx")
    sys.exit(1)

backup = app.with_suffix(".jsx.bak.nfs-ui")
backup.write_text(text, encoding="utf-8")

text = text.replace(old, new, 1)
app.write_text(text, encoding="utf-8")

print("Patch aplicado com sucesso.")
print(f"Backup salvo em: {backup}")
