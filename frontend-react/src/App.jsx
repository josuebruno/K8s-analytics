import { useEffect, useMemo, useState } from "react";
import {
  Play,
  Cpu,
  HardDrive,
  Database,
  Github,
  Code2,
  TerminalSquare,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
  PlusCircle,
  MemoryStick,
  ServerCog,
  Download,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  LogOut,
  ShieldCheck,
  UserCircle2,
  LockKeyhole,
  History,
  Trash2,
  RotateCcw,
  Search,
  KeyRound,
  FolderCog,
  Network,
  DatabaseZap,
  FolderOpen
} from "lucide-react";

const API = "/api";

const SAFE_LIMITS = {
  cpuMax: 2,
  ramMax: 4,
  diskMax: 4
};

const PRESETS = {
  leve: { cpus: "1", ram: "2", disk: "1" },
  medio: { cpus: "1", ram: "4", disk: "2" },
  pesado: { cpus: "2", ram: "6", disk: "3" }
};

const BASE_HELP = {
  sql: {
    icon: "🗄️",
    title: "Cadastro SQL",
    text: "Informe host, porta, banco e tabela/query no JSON. O uso operacional dessa base no runner entra no próximo bloco."
  },
  smb: {
    icon: "🗂️",
    title: "Cadastro SMB",
    text: "Informe servidor, share e caminho no JSON. O uso operacional dessa base no runner entra no próximo bloco."
  },
  nfs: {
    icon: "💾",
    title: "Cadastro NFS",
    text: "Informe servidor, export e caminho no JSON. O uso operacional dessa base no runner entra no próximo bloco."
  },
  file: {
    icon: "📄",
    title: "Cadastro File",
    text: "Informe um caminho conhecido pelo ambiente, como um arquivo em /shared/testdata ou outra origem já preparada."
  }
};

const INITIAL_PYTHON = `import os
import matplotlib
matplotlib.use("Agg")
import numpy as np
import matplotlib.pyplot as plt

output_dir = os.getenv("OUTPUT_DIR", "/output")
artifacts_dir = os.getenv("ARTIFACTS_DIR", f"{output_dir}/artifacts")
os.makedirs(artifacts_dir, exist_ok=True)

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.figure(figsize=(10, 5))
plt.plot(x, y)
plt.title("Seno")
plt.grid(True, alpha=0.3)
plt.savefig(f"{artifacts_dir}/grafico.png", dpi=150, bbox_inches="tight")
print("Arquivo gerado com sucesso")
`;

const INITIAL_R = `artifacts_dir <- Sys.getenv("ARTIFACTS_DIR", "/output/artifacts")
dir.create(artifacts_dir, recursive = TRUE, showWarnings = FALSE)

png(filename = file.path(artifacts_dir, "grafico_r.png"))
x <- seq(0, 10, length.out = 100)
y <- sin(x)
plot(x, y, type = "l", col = "blue", lwd = 2, main = "Seno em R")
dev.off()

cat("Arquivo gerado com sucesso\\n")
`;

function JsonPanel({ title, data }) {
  return (
    <div className="panel">
      <label>{title}</label>
      <pre>{data ? JSON.stringify(data, null, 2) : "Sem dados"}</pre>

    </div>
  );
}

function TextPanel({ title, data }) {
  return (
    <div className="panel">
      <label>{title}</label>
      <pre>{data?.content || "Sem conteúdo"}</pre>
    </div>
  );
}

function ArtifactCard({ artifact, getArtifactUrl }) {
  const isImage = String(artifact?.type || "").startsWith("image/");
  const previewUrl = getArtifactUrl(artifact, "artifact");
  const downloadUrl = getArtifactUrl(artifact, "download");

  return (
    <div className="artifactCard">
      <div className="artifactHeader">
        <div>
          <strong>{artifact.name}</strong>
          <div className="artifactMeta">
            {artifact.type || "arquivo"} {artifact.size_bytes ? `• ${artifact.size_bytes} bytes` : ""}
          </div>
        </div>

        <a className="linkBtn" href={downloadUrl} download={artifact.name}>
          <Download size={14} />
          Baixar
        </a>
      </div>

      {isImage ? (
        <div className="artifactBody">
          <img src={previewUrl} alt={artifact.name} className="artifactImage" />
        </div>
      ) : (
        <div className="artifactBody artifactText">
          Pré-visualização automática disponível para imagens. Outros arquivos podem ser baixados pelo botão acima.
        </div>
      )}
    </div>
  );
}

function FullscreenLoader({ text }) {
  return (
    <div className="authShell">
      <div className="authCard authCenter">
        <Loader2 size={24} className="spin" />
        <h2>{text}</h2>
      </div>
    </div>
  );
}

function statusBadgeClass(status) {
  return `historyBadge status-${status || "idle"}`;
}

function sourceTypeIcon(type) {
  if (type === "sql" || type === "postgres" || type === "mysql" || type === "oracle") {
    return <DatabaseZap size={16} />;
  }
  if (type === "smb") {
    return <Network size={16} />;
  }
  if (type === "nfs") {
    return <FolderOpen size={16} />;
  }
  return <Database size={16} />;
}

export default function App() {
  const [authChecking, setAuthChecking] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [loadingCatalogs, setLoadingCatalogs] = useState(true);
  const [submittingBase, setSubmittingBase] = useState(false);
  const [submittingGitCredential, setSubmittingGitCredential] = useState(false);
  const [executing, setExecuting] = useState(false);

  const [language, setLanguage] = useState("python");
  const [sourceMode, setSourceMode] = useState("inline");
  const [useDataSource, setUseDataSource] = useState(false);

  const [runName, setRunName] = useState("Execução Python");
  const [jobBaseName, setJobBaseName] = useState("analytics-python-web");
  const [outputSubdirBase, setOutputSubdirBase] = useState("web-run");
  const [cpus, setCpus] = useState("1");
  const [ram, setRam] = useState("2");
  const [disk, setDisk] = useState("1");

  const [dataSources, setDataSources] = useState([]);
  const [selectedDataSource, setSelectedDataSource] = useState("");

  const [showBaseManager, setShowBaseManager] = useState(false);
  const [editingBaseId, setEditingBaseId] = useState(null);
  const [baseName, setBaseName] = useState("clientes_csv_web");
  const [baseType, setBaseType] = useState("file");
  const [baseFormat, setBaseFormat] = useState("csv");
  const [baseDescription, setBaseDescription] = useState("Base cadastrada pela interface");
  const [baseUnchecked, setBaseUnchecked] = useState(false);
  const [showBaseHelp, setShowBaseHelp] = useState("file");
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [helpModalTitle, setHelpModalTitle] = useState("");
  const [helpModalText, setHelpModalText] = useState("");

  function openFunctionalHelp() {
    if (baseType === "file") {
      setHelpModalTitle("Ajuda • Base FILE");
      setHelpModalText(`Como cadastrar:
1. Escolha o tipo FILE.
2. Informe um caminho já visível no pod.
3. Exemplo:
   /shared/testdata/clientes.csv

Como utilizar no código:

Python:
import pandas as pd
df = pd.read_csv("/shared/testdata/clientes.csv")

R:
df <- read.csv("/shared/testdata/clientes.csv")

Observação:
FILE funciona quando o caminho já existe no ambiente compartilhado do cluster.`);
      setHelpModalOpen(true);
      return;
    }

    if (baseType === "nfs") {
      setHelpModalTitle("Ajuda • Base NFS");
      setHelpModalText(`Como cadastrar no formulário atual:
1. Tipo: NFS
2. Servidor: 10.100.58.50
3. Export: /1
4. Caminho: testdata/clientes.csv
5. Versão: 4.1
6. Variáveis cofre JSON:
   {
     "DATA_PATH": "/shared/testdata/clientes.csv"
   }

Exemplo prático:
Servidor: 10.100.58.50
Export: /1
Caminho: testdata/clientes.csv
Versão: 4.1

Como utilizar no código:

Python:
import pandas as pd
df = pd.read_csv("/shared/testdata/clientes.csv")

R:
df <- read.csv("/shared/testdata/clientes.csv")

Observação:
Nesta etapa, o NFS precisa apontar para o export compartilhado do cluster.
O caminho informado no formulário vira um caminho visível dentro do pod, por exemplo:
/shared/testdata/clientes.csv`);
      setHelpModalOpen(true);
      return;
    }
  }

  function closeHelpModal() {
    setHelpModalOpen(false);
    setHelpModalTitle("");
    setHelpModalText("");
  }
  const [basePath, setBasePath] = useState("/shared/testdata/clientes.csv");
  const [baseSmbServer, setBaseSmbServer] = useState("");
  const [baseSmbShare, setBaseSmbShare] = useState("");
  const [baseSmbPath, setBaseSmbPath] = useState("");
  const [baseSmbDomain, setBaseSmbDomain] = useState("");
  const [baseSmbUser, setBaseSmbUser] = useState("");
  const [baseSmbPassword, setBaseSmbPassword] = useState("");
  const [baseApiUrl, setBaseApiUrl] = useState("");
  const [baseApiMethod, setBaseApiMethod] = useState("GET");
  const [baseApiHeaders, setBaseApiHeaders] = useState('{}\n');
  const [baseApiBody, setBaseApiBody] = useState('{}\n');
  const [baseApiToken, setBaseApiToken] = useState("");
  const [baseApiUser, setBaseApiUser] = useState("");
  const [baseApiPassword, setBaseApiPassword] = useState("");
  const [baseNfsServer, setBaseNfsServer] = useState("");
  const [baseNfsExport, setBaseNfsExport] = useState("");
  const [baseNfsPath, setBaseNfsPath] = useState("");
  const [baseNfsVersion, setBaseNfsVersion] = useState("4.1");
  const [baseNfsVaultVars, setBaseNfsVaultVars] = useState('{}\n');
  const [baseSqlHost, setBaseSqlHost] = useState("");
  const [baseSqlPort, setBaseSqlPort] = useState("1433");
  const [baseSqlDatabase, setBaseSqlDatabase] = useState("");
  const [baseSqlSchema, setBaseSqlSchema] = useState("");
  const [baseSqlQuery, setBaseSqlQuery] = useState("");
  const [baseSqlUser, setBaseSqlUser] = useState("");
  const [baseSqlPassword, setBaseSqlPassword] = useState("");

  const [inlineCode, setInlineCode] = useState(INITIAL_PYTHON);
  const [gitCredentials, setGitCredentials] = useState([]);
  const [selectedGitCredentialId, setSelectedGitCredentialId] = useState("");
  const [gitUrl, setGitUrl] = useState("https://github.com/usuario/repositorio.git");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitEntryFile, setGitEntryFile] = useState("main.py");

  const [gitCredentialName, setGitCredentialName] = useState("GitHub pessoal");
  const [gitCredentialProvider, setGitCredentialProvider] = useState("github");
  const [gitCredentialAuthType, setGitCredentialAuthType] = useState("token");
  const [gitCredentialUsername, setGitCredentialUsername] = useState("");
  const [gitCredentialToken, setGitCredentialToken] = useState("");
  const [gitCredentialPrivateKey, setGitCredentialPrivateKey] = useState("");
  const [gitCredentialKnownHosts, setGitCredentialKnownHosts] = useState("");

  const [jobRunsResponse, setJobRunsResponse] = useState(null);
  const [jobRunsQuery, setJobRunsQuery] = useState("");
  const [jobRunsStatus, setJobRunsStatus] = useState("");
  const [jobRunsLanguage, setJobRunsLanguage] = useState("");
  const [jobRunsPage, setJobRunsPage] = useState(1);
  const [jobRunsPageSize, setJobRunsPageSize] = useState(10);

  const [apiResponse, setApiResponse] = useState(null);
  const [resultResponse, setResultResponse] = useState(null);
  const [stdoutResponse, setStdoutResponse] = useState(null);
  const [stderrResponse, setStderrResponse] = useState(null);
  const [logsResponse, setLogsResponse] = useState(null);

  const [runState, setRunState] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("Pronto para executar.");
  const [validationErrors, setValidationErrors] = useState([]);

  async function apiGet(path, options = {}) {
    const { allow401 = false } = options;

    const resp = await fetch(`${API}${path}`, {
      credentials: "include",
    });

    const contentType = resp.headers.get("content-type") || "";

    if (resp.status === 401) {
      if (!allow401) {
        setCurrentUser(null);
      }
      return null;
    }

    if (contentType.includes("application/json")) {
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.detail || "Falha na requisição");
      return data;
    }

    const text = await resp.text();
    if (!resp.ok) throw new Error(text || "Falha na requisição");
    return text;
  }

  async function apiPost(path, payload) {
    const resp = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (resp.status === 401) {
      setCurrentUser(null);
      throw new Error("Sessão inválida ou expirada");
    }

    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.detail || "Falha na requisição");
    return data;
  }

  async function apiDelete(path) {
    const resp = await fetch(`${API}${path}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (resp.status === 401) {
      setCurrentUser(null);
      throw new Error("Sessão inválida ou expirada");
    }

    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.detail || "Falha na requisição");
    return data;
  }

  async function checkSession() {
    setAuthChecking(true);
    try {
      const data = await apiGet("/auth/me", { allow401: true });
      if (data?.user) {
        setCurrentUser(data.user);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthChecking(false);
    }
  }

  async function loadDataSources() {
    const data = await apiGet("/data-sources-v2");
    if (!data) return;
    setDataSources(data.items || []);
    if (!selectedDataSource && data.items?.length) {
      setSelectedDataSource(String(data.items[0].id));
    }
  }

  async function loadGitCredentials() {
    const data = await apiGet("/git-credentials");
    if (!data) return;
    setGitCredentials(data.items || []);
    if (!selectedGitCredentialId && data.items?.length) {
      setSelectedGitCredentialId(String(data.items[0].id));
    }
  }

  async function loadJobRuns(pageOverride = null) {
    const page = pageOverride ?? jobRunsPage;
    const params = new URLSearchParams();
    if (jobRunsQuery) params.set("q", jobRunsQuery);
    if (jobRunsStatus) params.set("status", jobRunsStatus);
    if (jobRunsLanguage) params.set("language", jobRunsLanguage);
    params.set("page", String(page));
    params.set("page_size", String(jobRunsPageSize));

    const data = await apiGet(`/job-runs?${params.toString()}`);
    if (!data) return;
    setJobRunsResponse(data);
  }

  async function refreshCatalogs() {
    if (!currentUser) return;

    setLoadingCatalogs(true);
    try {
      await Promise.all([loadDataSources(), loadGitCredentials(), loadJobRuns(1)]);
    } catch (e) {
      setApiResponse({ success: false, message: e.message });
      setRunState("failed");
      setStatusMessage(`Falha ao carregar catálogos: ${e.message}`);
    } finally {
      setLoadingCatalogs(false);
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (currentUser) {
      refreshCatalogs();
    } else {
      setLoadingCatalogs(false);
    }
  }, [currentUser]);

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    setCpus(preset.cpus);
    setRam(preset.ram);
    setDisk(preset.disk);
    setStatusMessage(`Preset aplicado: ${name}`);
  }

  function onLanguageChange(value) {
    setLanguage(value);
    setValidationErrors([]);
    setRunState("idle");

    if (value === "python") {
      setInlineCode(INITIAL_PYTHON);
      setRunName("Execução Python");
      setJobBaseName("analytics-python-web");
      setOutputSubdirBase("web-run");
      setGitEntryFile("main.py");
    } else if (value === "r") {
      setInlineCode(INITIAL_R);
      setRunName("Execução R");
      setJobBaseName("analytics-r-web");
      setOutputSubdirBase("r-run");
      setGitEntryFile("main.R");
    } else {
      setRunName("Execução híbrida");
      setJobBaseName("analytics-hybrid-web");
      setOutputSubdirBase("hybrid-run");
      setGitEntryFile("main.py");
    }
  }

  function validateRun() {
    const errors = [];
    const cpu = Number(cpus);
    const memory = Number(ram);
    const storage = Number(disk);

    if (!Number.isFinite(cpu) || cpu < 1) errors.push("CPU precisa ser pelo menos 1.");
    if (!Number.isFinite(memory) || memory < 1) errors.push("RAM precisa ser pelo menos 1 GiB.");
    if (!Number.isFinite(storage) || storage < 1) errors.push("Disco precisa ser pelo menos 1 GiB.");

    if (cpu > SAFE_LIMITS.cpuMax) errors.push(`CPU máxima permitida na interface: ${SAFE_LIMITS.cpuMax}.`);
    if (memory > SAFE_LIMITS.ramMax) errors.push(`RAM máxima permitida na interface: ${SAFE_LIMITS.ramMax} GiB.`);
    if (storage > SAFE_LIMITS.diskMax) errors.push(`Disco máximo permitido na interface: ${SAFE_LIMITS.diskMax} GiB.`);

    if (useDataSource && !selectedDataSource) errors.push("Selecione uma base cadastrada ou desative o uso de base.");
    if (sourceMode === "inline" && !inlineCode.trim()) errors.push("O código inline não pode ficar vazio.");
    if (sourceMode === "git" && !gitUrl.trim()) errors.push("Informe a URL do repositório Git.");
    if (sourceMode === "git" && !gitEntryFile.trim()) errors.push("Informe o arquivo principal do repositório.");

    return errors;
  }

  function normalizeRunError(message) {
    if (!message) return "Falha inesperada.";
    if (message.includes("timed out waiting for the condition")) {
      return "O Job foi criado, mas não concluiu dentro do tempo esperado. Verifique status e logs.";
    }
    if (message.includes("Insufficient cpu")) {
      return "Sem CPU suficiente no nó atual. Reduza os recursos da execução.";
    }
    if (message.includes("OOMKilled")) {
      return "A execução excedeu o limite de memória (OOMKilled). Aumente a RAM e tente novamente.";
    }
    return message;
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError("");

    try {
      const data = await apiPost("/auth/login", {
        username: loginUsername,
        password: loginPassword,
      });

      setCurrentUser(data.user);
      setLoginPassword("");
      setStatusMessage(`Bem-vindo, ${data.user.display_name || data.user.username}.`);
    } catch (e) {
      setLoginError(e.message);
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout() {
    try {
      await apiPost("/auth/logout", {});
    } catch {
      // ignora
    }

    setCurrentUser(null);
    setLoginUsername("");
    setLoginPassword("");
    setApiResponse(null);
    setResultResponse(null);
    setStdoutResponse(null);
    setStderrResponse(null);
    setLogsResponse(null);
    setJobRunsResponse(null);
    setRunState("idle");
    setStatusMessage("Sessão encerrada.");
  }

  function resetBaseForm() {
    setEditingBaseId(null);
    setBaseName("clientes_csv_web");
    setBaseType("file");
    setBaseFormat("csv");
    setBaseDescription("Base cadastrada pela interface");
    setBaseUnchecked(false);
    setShowBaseHelp("file");
    setBasePath("/shared/testdata/clientes.csv");
    setBaseSmbServer("");
    setBaseSmbShare("");
    setBaseSmbPath("");
    setBaseSmbDomain("");
    setBaseSmbUser("");
    setBaseSmbPassword("");
    setBaseApiUrl("");
    setBaseApiMethod("GET");
    setBaseApiHeaders("{}\n");
    setBaseApiBody("{}\n");
    setBaseApiToken("");
    setBaseApiUser("");
    setBaseApiPassword("");
    setBaseNfsServer("");
    setBaseNfsExport("");
    setBaseNfsPath("");
    setBaseNfsVersion("4.1");
    setBaseNfsVaultVars("{}\n");
    setBaseSqlHost("");
    setBaseSqlPort("1433");
    setBaseSqlDatabase("");
    setBaseSqlSchema("");
    setBaseSqlQuery("");
    setBaseSqlUser("");
    setBaseSqlPassword("");
  }

  function buildBasePayload() {
    let connection_json = {};
    let secrets_json = {};

    if (baseType === "file") {
      connection_json = { path: basePath };
    } else if (baseType === "smb") {
      connection_json = {
        server: baseSmbServer,
        share: baseSmbShare,
        path: baseSmbPath,
        domain: baseSmbDomain,
      };
      secrets_json = {
        username: baseSmbUser,
        password: baseSmbPassword,
      };
    } else if (baseType === "api") {
      connection_json = {
        url: baseApiUrl,
        method: baseApiMethod,
        headers: baseApiHeaders.trim() ? JSON.parse(baseApiHeaders) : {},
        body: baseApiBody.trim() ? JSON.parse(baseApiBody) : {},
      };
      secrets_json = {
        token: baseApiToken,
        username: baseApiUser,
        password: baseApiPassword,
      };
    } else if (baseType === "nfs") {
      connection_json = {
        server: baseNfsServer,
        export_path: baseNfsExport,
        path: baseNfsPath,
        version: baseNfsVersion,
        vault_vars: baseNfsVaultVars.trim() ? JSON.parse(baseNfsVaultVars) : {},
      };
    } else {
      connection_json = {
        host: baseSqlHost,
        port: Number(baseSqlPort),
        database: baseSqlDatabase,
        schema: baseSqlSchema,
        query: baseSqlQuery,
      };
      secrets_json = {
        username: baseSqlUser,
        password: baseSqlPassword,
      };
    }

    return {
      name: baseName,
      source_type: baseType,
      data_format: baseFormat,
      description: baseDescription,
      connection_json,
      secrets_json,
      icon: baseType,
      instructions: BASE_HELP[showBaseHelp]?.text || null,
      is_enabled: !baseUnchecked,
    };
  }

  async function saveDataSource() {
    setSubmittingBase(true);
    try {
      const payload = buildBasePayload();

      let response;
      if (editingBaseId) {
        response = await fetch(`${API}/data-sources-v2/${editingBaseId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }).then(async (resp) => {
          const data = await resp.json();
          if (!resp.ok) throw new Error(data?.detail || "Falha ao editar base");
          return data;
        });
        setStatusMessage("Base atualizada com sucesso.");
      } else {
        response = await apiPost("/data-sources-v2", payload);
        setStatusMessage("Base cadastrada com sucesso.");
      }

      setApiResponse(response);
      await loadDataSources();
      resetBaseForm();
      setShowBaseManager(false);
    } catch (e) {
      setApiResponse({ success: false, message: e.message });
      setStatusMessage(`Falha ao salvar base: ${e.message}`);
    } finally {
      setSubmittingBase(false);
    }
  }

  function populateBaseForm(ds) {
    resetBaseForm();
    setEditingBaseId(ds.id);
    setShowBaseManager(true);
    setBaseName(ds.name || "");
    setBaseType(ds.source_type || "file");
    setShowBaseHelp(ds.source_type || "file");
    setBaseFormat(ds.data_format || "csv");
    setBaseDescription(ds.description || "");
    setBaseUnchecked(!ds.is_enabled);

    const cj = ds.connection_json || {};
    const sj = ds.secrets_json || {};

    if (ds.source_type === "file") {
      setBasePath(cj.path || "");
    } else if (ds.source_type === "smb") {
      setBaseSmbServer(cj.server || "");
      setBaseSmbShare(cj.share || "");
      setBaseSmbPath(cj.path || "");
      setBaseSmbDomain(cj.domain || "");
      setBaseSmbUser(sj.username || "");
      setBaseSmbPassword(sj.password || "");
    } else if (ds.source_type === "api") {
      setBaseApiUrl(cj.url || "");
      setBaseApiMethod(cj.method || "GET");
      setBaseApiHeaders(JSON.stringify(cj.headers || {}, null, 2));
      setBaseApiBody(JSON.stringify(cj.body || {}, null, 2));
      setBaseApiToken(sj.token || "");
      setBaseApiUser(sj.username || "");
      setBaseApiPassword(sj.password || "");
    } else if (ds.source_type === "nfs") {
      setBaseNfsServer(cj.server || "");
      setBaseNfsExport(cj.export_path || "");
      setBaseNfsPath(cj.path || "");
      setBaseNfsVersion(cj.version || "4.1");
      setBaseNfsVaultVars(JSON.stringify(cj.vault_vars || {}, null, 2));
    } else {
      setBaseSqlHost(cj.host || "");
      setBaseSqlPort(String(cj.port || "1433"));
      setBaseSqlDatabase(cj.database || "");
      setBaseSqlSchema(cj.schema || "");
      setBaseSqlQuery(cj.query || "");
      setBaseSqlUser(sj.username || "");
      setBaseSqlPassword(sj.password || "");
    }
  }

  async function deleteDataSource(id, name) {
    const ok = window.confirm(`Deseja deletar a base "${name}"?`);
    if (!ok) return;

    try {
      await apiDelete(`/data-sources-v2/${id}`);
      setStatusMessage("Base deletada com sucesso.");
      await loadDataSources();
    } catch (e) {
      setStatusMessage(`Falha ao deletar base: ${e.message}`);
    }
  }

  async function testDataSource(id) {
    try {
      const response = await apiPost(`/data-sources-v2/${id}/test`, {});
      setStatusMessage(response.message || "Teste executado.");
      await loadDataSources();
    } catch (e) {
      setStatusMessage(`Falha ao testar base: ${e.message}`);
    }
  }

  async function createGitCredential() {
    setSubmittingGitCredential(true);
    try {
      const payload = {
        name: gitCredentialName,
        provider: gitCredentialProvider,
        auth_type: gitCredentialAuthType,
        git_username: gitCredentialUsername || null,
        token: gitCredentialAuthType === "token" ? gitCredentialToken : null,
        private_key: gitCredentialAuthType === "ssh_key" ? gitCredentialPrivateKey : null,
        known_hosts: gitCredentialAuthType === "ssh_key" ? gitCredentialKnownHosts : null,
      };

      const response = await apiPost("/git-credentials", payload);
      setApiResponse(response);
      setStatusMessage("Credencial Git cadastrada com sucesso.");
      setGitCredentialToken("");
      setGitCredentialPrivateKey("");
      await loadGitCredentials();
    } catch (e) {
      setApiResponse({ success: false, message: e.message });
      setStatusMessage(`Falha ao cadastrar credencial Git: ${e.message}`);
    } finally {
      setSubmittingGitCredential(false);
    }
  }

  async function deleteGitCredential(id) {
    try {
      await apiDelete(`/git-credentials/${id}`);
      setStatusMessage("Credencial Git removida.");
      await loadGitCredentials();
    } catch (e) {
      setStatusMessage(`Falha ao remover credencial Git: ${e.message}`);
    }
  }

  async function createCodeSource() {
    if (sourceMode === "inline") {
      return apiPost("/code-sources", {
        source_mode: "inline",
        language,
        inline_code: inlineCode,
      });
    }

    return apiPost("/code-sources", {
      source_mode: "git",
      language,
      git_url: gitUrl,
      git_branch: gitBranch,
      entry_file: gitEntryFile,
      git_credential_id: selectedGitCredentialId ? Number(selectedGitCredentialId) : null,
    });
  }

  async function executeRun() {
    if (executing) return;

    const errors = validateRun();
    setValidationErrors(errors);

    if (errors.length > 0) {
      setRunState("failed");
      setStatusMessage("Ajuste os campos destacados antes de executar.");
      return;
    }

    setExecuting(true);
    setRunState("submitting");
    setStatusMessage("Criando code source e preparando execução...");
    setApiResponse({ info: "Executando..." });
    setResultResponse(null);
    setStdoutResponse(null);
    setStderrResponse(null);
    setLogsResponse(null);

    try {
      if (language === "python+r") {
        setRunState("failed");
        setStatusMessage("O runner híbrido python+r ainda não foi ligado na interface.");
        return;
      }

      const codeSource = await createCodeSource();

      const runEndpoint =
        language === "r"
          ? "/run/r/by-source"
          : "/run/python/by-source";

      setRunState("running");
      setStatusMessage("Job enviado. Aguardando conclusão da execução...");

      const run = await apiPost(runEndpoint, {
        run_name: runName,
        data_source_id: useDataSource ? Number(selectedDataSource) : null,
        code_source_id: codeSource.id,
        job_base_name: jobBaseName,
        output_subdir_base: outputSubdirBase,
        ram_limit_gb: ram,
        cpus,
        ephemeral_storage_gb: disk,
      });

      await consumeRunResponse(run);
      await loadJobRuns(1);
    } catch (e) {
      const err = normalizeRunError(e.message);
      setApiResponse({ success: false, message: err });
      setRunState("failed");
      setStatusMessage(err);
    } finally {
      setExecuting(false);
    }
  }

  async function consumeRunResponse(run) {
    setApiResponse(run);

    if (run.result_path) {
      const result = await apiGet(`/result?path=${encodeURIComponent(run.result_path)}`);
      setResultResponse(result);
    } else {
      setResultResponse(null);
    }

    if (run.stdout_log_path) {
      const stdout = await apiGet(`/file?path=${encodeURIComponent(run.stdout_log_path)}`);
      setStdoutResponse(stdout);
    } else {
      setStdoutResponse(null);
    }

    if (run.stderr_log_path) {
      const stderr = await apiGet(`/file?path=${encodeURIComponent(run.stderr_log_path)}`);
      setStderrResponse(stderr);
    } else {
      setStderrResponse(null);
    }

    if (run.job_name) {
      const logs = await apiGet(`/logs/${run.job_name}`);
      setLogsResponse(logs);
    } else {
      setLogsResponse(null);
    }

    if (run.oom_killed) {
      setRunState("failed");
      setStatusMessage(run.display_message || "A execução excedeu o limite de memória (OOMKilled).");
    } else if (run.success) {
      setRunState("completed");
      setStatusMessage(run.display_message || `Execução concluída com sucesso. Job: ${run.job_name}`);
    } else {
      const err = run.display_message || normalizeRunError(run.stderr || run.stdout || "Falha na execução.");
      setRunState("failed");
      setStatusMessage(err);
    }
  }

  async function rerunJob(id) {
    try {
      setStatusMessage("Reexecutando...");
      const run = await apiPost(`/job-runs/${id}/rerun`, {});
      await consumeRunResponse(run);
      await loadJobRuns(jobRunsPage);
    } catch (e) {
      setStatusMessage(`Falha ao reexecutar: ${e.message}`);
    }
  }

  async function deleteJobRun(id) {
    try {
      await apiDelete(`/job-runs/${id}`);
      setStatusMessage("Execução removida do histórico.");
      await loadJobRuns(jobRunsPage);
    } catch (e) {
      setStatusMessage(`Falha ao remover histórico: ${e.message}`);
    }
  }

  const resultData = resultResponse?.data || null;
  const artifacts = resultData?.artifacts || [];
  const resultPath = resultResponse?.path || "";
  const verboseOutput =
    logsResponse?.logs ||
    apiResponse?.stdout ||
    stdoutResponse?.content ||
    stderrResponse?.content ||
    "";

  function getArtifactUrl(artifact, mode = "artifact") {
    let resolvedPath = null;

    if (artifact?.path && (String(artifact.path).startsWith("/opt/analytics/") || String(artifact.path).startsWith("/shared/"))) {
      resolvedPath = artifact.path;
    } else if (artifact?.relative_path && resultPath) {
      const baseDir = String(resultPath).replace(/\/result\.json$/, "");
      const rel = String(artifact.relative_path).replace(/^\/+/, "");

      if (rel.startsWith("artifacts/")) {
        resolvedPath = `${baseDir}/${rel}`;
      } else {
        resolvedPath = `${baseDir}/artifacts/${rel}`;
      }
    } else if (artifact?.name && resultPath) {
      const baseDir = String(resultPath).replace(/\/result\.json$/, "");
      resolvedPath = `${baseDir}/artifacts/${artifact.name}`;
    }

    if (!resolvedPath) return "#";

    return `${API}/${mode}?path=${encodeURIComponent(resolvedPath)}`;
  }

  const summary = useMemo(() => {
    return {
      language,
      sourceMode,
      cpu: cpus,
      ram,
      disk,
      withDataSource: useDataSource
    };
  }, [language, sourceMode, cpus, ram, disk, useDataSource]);

  const runStateClass = `statusBanner status-${runState}`;

  if (authChecking) {
    return <FullscreenLoader text="Verificando sessão..." />;
  }

  if (!currentUser) {
    return (
      <div className="authShell">
        <div className="authCard">
          <div className="authBrand">
            <div className="heroBadge">
              <Sparkles size={14} />
              Plataforma Analítica
            </div>
            <h1>Acesso à plataforma</h1>
            <p>
              Entre com sua conta institucional. O acesso é validado no Active Directory e restrito ao grupo autorizado.
            </p>
          </div>

          <form className="authForm" onSubmit={handleLogin}>
            <label>Usuário</label>
            <div className="authInputWrap">
              <UserCircle2 size={18} />
              <input
                type="text"
                placeholder="seu.usuario"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoComplete="username"
              />
            </div>

            <label>Senha</label>
            <div className="authInputWrap">
              <LockKeyhole size={18} />
              <input
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {loginError && (
              <div className="authError">
                <AlertCircle size={16} />
                <span>{loginError}</span>
              </div>
            )}

            <button type="submit" className="runBtn" disabled={loggingIn}>
              {loggingIn ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbarUser">
          <UserCircle2 size={18} />
          <div>
            <strong>{currentUser.display_name || currentUser.username}</strong>
            <span>{currentUser.username}</span>
          </div>
        </div>

        <button className="logoutBtn" onClick={handleLogout}>
          <LogOut size={16} />
          Sair
        </button>
      </div>

      <div className="hero">
        <div className="heroText">
          <div className="heroBadge">
            <Sparkles size={14} />
            Plataforma Analítica
          </div>

          <h1>Execução efêmera com Python, R e Git por usuário</h1>

          <p>
            Cadastre credenciais Git próprias, conecte bases, escolha o arquivo principal do repositório e execute em Jobs isolados.
          </p>
        </div>

        <div className="summaryCard">
          <div className="summaryHeader">
            <ServerCog size={18} />
            <span>Resumo da execução</span>
          </div>

          <div className="summaryGrid">
            <div className="summaryItem">
              <span>CPU</span>
              <strong>{summary.cpu}</strong>
            </div>
            <div className="summaryItem">
              <span>RAM</span>
              <strong>{summary.ram}Gi</strong>
            </div>
            <div className="summaryItem">
              <span>Disco</span>
              <strong>{summary.disk}Gi</strong>
            </div>
            <div className="summaryItem">
              <span>Base</span>
              <strong>{summary.withDataSource ? "Com base" : "Sem base"}</strong>
            </div>
          </div>

          <div className="summaryMeta">
            <div><b>Linguagem:</b> {summary.language}</div>
            <div><b>Origem:</b> {summary.sourceMode}</div>
            <div><b>Run name:</b> {runName}</div>
          </div>
        </div>
      </div>

      <div className={runStateClass}>
        <div className="statusBadge">{runState.toUpperCase()}</div>
        <div>{statusMessage}</div>
      </div>

      {validationErrors.length > 0 && (
        <div className="validationBox">
          <strong>Corrija antes de executar:</strong>
          <ul>
            {validationErrors.map((err, idx) => (
              <li key={`${err}-${idx}`}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="layout">
        <div className="leftColumn">
          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><History size={18} /></div>
              <div>
                <h2>Histórico de execuções</h2>
                <p>Pesquisa, paginação, reexecução e remoção lógica do histórico.</p>
              </div>
            </div>

            <div className="historyToolbar">
              <div className="searchWrap">
                <Search size={14} />
                <input
                  placeholder="Pesquisar execução..."
                  value={jobRunsQuery}
                  onChange={(e) => setJobRunsQuery(e.target.value)}
                />
              </div>

              <select value={jobRunsStatus} onChange={(e) => setJobRunsStatus(e.target.value)}>
                <option value="">Todos status</option>
                <option value="completed">completed</option>
                <option value="failed">failed</option>
              </select>

              <select value={jobRunsLanguage} onChange={(e) => setJobRunsLanguage(e.target.value)}>
                <option value="">Todas linguagens</option>
                <option value="python">python</option>
                <option value="r">r</option>
              </select>

              <select value={jobRunsPageSize} onChange={(e) => setJobRunsPageSize(Number(e.target.value))}>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
              </select>

              <button className="secondaryBtn" onClick={() => { setJobRunsPage(1); loadJobRuns(1); }}>
                <Search size={16} />
                Buscar
              </button>
            </div>

            <div className="historyTableWrap">
              <table className="historyTable">
                <thead>
                  <tr>
                    <th>Run name</th>
                    <th>Linguagem</th>
                    <th>Status</th>
                    <th>Nó</th>
                    <th>Data</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobRunsResponse?.items || []).length === 0 ? (
                    <tr>
                      <td colSpan="6">
                        <div className="historyEmpty">Nenhuma execução encontrada.</div>
                      </td>
                    </tr>
                  ) : (
                    (jobRunsResponse?.items || []).map((job) => (
                      <tr key={job.id}>
                        <td>
                          <div className="runTitle">
                            <strong>{job.run_name || job.job_name}</strong>
                            <span>{job.job_name}</span>
                          </div>
                        </td>
                        <td>{job.language}</td>
                        <td>
                          <span className={statusBadgeClass(job.status)}>{job.status}</span>
                        </td>
                        <td>{job.node_name || "-"}</td>
                        <td>{job.created_at || "-"}</td>
                        <td>
                          <div className="actionsInline">
                            <button className="miniBtn" onClick={() => rerunJob(job.id)}>
                              <RotateCcw size={14} />
                            </button>
                            <button className="miniBtn dangerBtn" onClick={() => deleteJobRun(job.id)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="paginationBar">
              <button
                className="secondaryBtn"
                disabled={(jobRunsResponse?.page || 1) <= 1}
                onClick={() => {
                  const next = Math.max(1, (jobRunsResponse?.page || 1) - 1);
                  setJobRunsPage(next);
                  loadJobRuns(next);
                }}
              >
                Anterior
              </button>

              <span>
                Página {jobRunsResponse?.page || 1} de {jobRunsResponse?.pages || 1}
              </span>

              <button
                className="secondaryBtn"
                disabled={(jobRunsResponse?.page || 1) >= (jobRunsResponse?.pages || 1)}
                onClick={() => {
                  const next = Math.min(jobRunsResponse?.pages || 1, (jobRunsResponse?.page || 1) + 1);
                  setJobRunsPage(next);
                  loadJobRuns(next);
                }}
              >
                Próxima
              </button>
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><KeyRound size={18} /></div>
              <div>
                <h2>Credenciais Git</h2>
                <p>Cada usuário pode cadastrar a própria chave SSH ou token.</p>
              </div>
            </div>

            <div className="grid2">
              <div>
                <label>Nome</label>
                <input value={gitCredentialName} onChange={(e) => setGitCredentialName(e.target.value)} />
              </div>

              <div>
                <label>Provider</label>
                <select value={gitCredentialProvider} onChange={(e) => setGitCredentialProvider(e.target.value)}>
                  <option value="github">github</option>
                  <option value="gitlab">gitlab</option>
                  <option value="bitbucket">bitbucket</option>
                  <option value="generic">generic</option>
                </select>
              </div>

              <div>
                <label>Tipo</label>
                <select value={gitCredentialAuthType} onChange={(e) => setGitCredentialAuthType(e.target.value)}>
                  <option value="token">token</option>
                  <option value="ssh_key">ssh_key</option>
                </select>
              </div>

              <div>
                <label>Usuário Git</label>
                <input value={gitCredentialUsername} onChange={(e) => setGitCredentialUsername(e.target.value)} />
              </div>

              {gitCredentialAuthType === "token" ? (
                <div className="full">
                  <label>Token</label>
                  <textarea
                    className="jsonArea"
                    value={gitCredentialToken}
                    onChange={(e) => setGitCredentialToken(e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="full">
                    <label>Private key</label>
                    <textarea
                      className="jsonArea"
                      value={gitCredentialPrivateKey}
                      onChange={(e) => setGitCredentialPrivateKey(e.target.value)}
                    />
                  </div>
                  <div className="full">
                    <label>known_hosts</label>
                    <textarea
                      className="jsonArea"
                      value={gitCredentialKnownHosts}
                      onChange={(e) => setGitCredentialKnownHosts(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <button className="secondaryBtn" onClick={createGitCredential} disabled={submittingGitCredential}>
              {submittingGitCredential ? <Loader2 size={16} className="spin" /> : <PlusCircle size={16} />}
              {submittingGitCredential ? "Salvando..." : "Salvar credencial Git"}
            </button>

            <div className="credentialList">
              {(gitCredentials || []).map((cred) => (
                <div key={cred.id} className="credentialItem">
                  <div>
                    <strong>{cred.name}</strong>
                    <div className="artifactMeta">
                      {cred.provider} • {cred.auth_type} • {cred.git_username || "sem usuário"}
                    </div>
                  </div>
                  <button className="miniBtn dangerBtn" onClick={() => deleteGitCredential(cred.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><Code2 size={18} /></div>
              <div>
                <h2>Execução</h2>
                <p>Código inline ou repositório Git com arquivo principal selecionável.</p>
              </div>
            </div>

            <div className="grid3">
              <div>
                <label>Run name</label>
                <input value={runName} onChange={(e) => setRunName(e.target.value)} />
              </div>

              <div>
                <label>Linguagem</label>
                <select value={language} onChange={(e) => onLanguageChange(e.target.value)}>
                  <option value="python">python</option>
                  <option value="r">r</option>
                  <option value="python+r">python+r</option>
                </select>
              </div>

              <div>
                <label>Origem do código</label>
                <select value={sourceMode} onChange={(e) => setSourceMode(e.target.value)}>
                  <option value="inline">inline</option>
                  <option value="git">git</option>
                </select>
              </div>
            </div>

            <div className="grid2">
              <div>
                <label>Job base name</label>
                <input value={jobBaseName} onChange={(e) => setJobBaseName(e.target.value)} />
              </div>

              <div>
                <label>Output subdir base</label>
                <input value={outputSubdirBase} onChange={(e) => setOutputSubdirBase(e.target.value)} />
              </div>
            </div>

            {sourceMode === "inline" ? (
              <div className="editorWrap">
                <div className="editorTop">
                  <div className="editorDots">
                    <span className="dot red"></span>
                    <span className="dot yellow"></span>
                    <span className="dot green"></span>
                  </div>
                  <span className="editorFile">main.{language === "python" ? "py" : language === "r" ? "R" : "txt"}</span>
                </div>
                <textarea
                  className="editor"
                  value={inlineCode}
                  onChange={(e) => setInlineCode(e.target.value)}
                />
              </div>
            ) : (
              <div className="grid2">
                <div className="full">
                  <label><Github size={14} /> URL do repositório</label>
                  <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} />
                </div>

                <div>
                  <label>Branch</label>
                  <input value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
                </div>

                <div>
                  <label>Arquivo principal</label>
                  <input value={gitEntryFile} onChange={(e) => setGitEntryFile(e.target.value)} />
                </div>

                <div className="full">
                  <label>Credencial Git</label>
                  <select value={selectedGitCredentialId} onChange={(e) => setSelectedGitCredentialId(e.target.value)}>
                    <option value="">Sem credencial (repo público)</option>
                    {gitCredentials.map((cred) => (
                      <option key={cred.id} value={cred.id}>
                        {cred.name} ({cred.provider}/{cred.auth_type})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><FolderCog size={18} /></div>
              <div>
                <h2>Bases cadastradas</h2>
                <p>Cada usuário pode cadastrar SQL, SMB, NFS, API ou file.</p>
              </div>
            </div>

            <div className="actionsInline">
              <button
                className="secondaryBtn"
                onClick={() => {
                  if (!showBaseManager) resetBaseForm();
                  setShowBaseManager(!showBaseManager);
                }}
              >
                <PlusCircle size={16} />
                {showBaseManager ? "Fechar" : "Cadastrar"}
              </button>
            </div>

            {showBaseManager && (
              <>
                <div className="helpCard">
                  <div className="helpHeader">
                    <span>{BASE_HELP[showBaseHelp]?.icon}</span>
                    <strong>{editingBaseId ? "Editar base" : "Cadastro de base"} • {BASE_HELP[showBaseHelp]?.title}</strong>
                  </div>
                  <p>{BASE_HELP[showBaseHelp]?.text}</p>
                  {(baseType === "file" || baseType === "nfs" || baseType === "smb") && (
                    <div className="actionsInline" style={{ marginTop: "10px" }}>
                      <button type="button" className="secondaryBtn" onClick={openFunctionalHelp}>Ajuda</button>
                    </div>
                  )}
                </div>

                <div className="grid2">
                  <div>
                    <label>Nome</label>
                    <input value={baseName} onChange={(e) => setBaseName(e.target.value)} />
                  </div>

                  <div>
                    <label>Tipo</label>
                    <select
                      value={baseType}
                      onChange={(e) => {
                        setBaseType(e.target.value);
                        setShowBaseHelp(e.target.value);
                      }}
                    >
                      <option value="file">file</option>
                      <option value="smb">smb</option>
                      <option value="api">api / curl</option>
                      <option value="nfs">nfs</option>
                      <option value="sqlserver">sql server</option>
                      <option value="postgres">postgres</option>
                      <option value="mysql">mysql</option>
                      <option value="oracle">oracle</option>
                    </select>
                  </div>

                  <div>
                    <label>Formato</label>
                    <select value={baseFormat} onChange={(e) => setBaseFormat(e.target.value)}>
                      <option value="csv">csv</option>
                      <option value="parquet">parquet</option>
                      <option value="json">json</option>
                      <option value="xlsx">xlsx</option>
                      <option value="table">table</option>
                    </select>
                  </div>

                  <div className="full">
                    <label>Descrição</label>
                    <input value={baseDescription} onChange={(e) => setBaseDescription(e.target.value)} />
                  </div>
                </div>

                {baseType === "file" && (
                  <div className="grid2">
                    <div className="full">
                      <label>Caminho</label>
                      <input value={basePath} onChange={(e) => setBasePath(e.target.value)} />
                    </div>
                  </div>
                )}

                {baseType === "smb" && (
                  <div className="grid2">
                    <div>
                      <label>Servidor / Storage</label>
                      <input
                        value={baseSmbServer}
                        onChange={(e) => setBaseSmbServer(e.target.value)}
                        title="Hostname ou IP do servidor SMB"
                        placeholder="10.10.10.10"
                      />
                    </div>
                    <div>
                      <label>Share</label>
                      <input
                        value={baseSmbShare}
                        onChange={(e) => setBaseSmbShare(e.target.value)}
                        title="Nome do compartilhamento"
                        placeholder="dados"
                      />
                    </div>
                    <div>
                      <label>Caminho</label>
                      <input
                        value={baseSmbPath}
                        onChange={(e) => setBaseSmbPath(e.target.value)}
                        title="Caminho do arquivo dentro do share"
                        placeholder="/entrada/clientes.csv"
                      />
                    </div>
                    <div>
                      <label>Domínio</label>
                      <input
                        value={baseSmbDomain}
                        onChange={(e) => setBaseSmbDomain(e.target.value)}
                        title="Domínio Windows, se existir"
                        placeholder="IPEA"
                      />
                    </div>
                    <div>
                      <label>Usuário</label>
                      <input
                        value={baseSmbUser}
                        onChange={(e) => setBaseSmbUser(e.target.value)}
                        title="Usuário do compartilhamento"
                        placeholder="usuario"
                      />
                    </div>
                    <div>
                      <label>Senha</label>
                      <input
                        type="password"
                        value={baseSmbPassword}
                        onChange={(e) => setBaseSmbPassword(e.target.value)}
                        title="Senha cifrada no banco"
                        placeholder="********"
                      />
                    </div>
                  </div>
                )}

                {baseType === "api" && (
                  <div className="grid2">
                    <div className="full"><label>URL ?</label><input value={baseApiUrl} onChange={(e) => setBaseApiUrl(e.target.value)} title="URL completa do endpoint" /></div>
                    <div><label>Método</label><select value={baseApiMethod} onChange={(e) => setBaseApiMethod(e.target.value)}><option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option></select></div>
                    <div><label>Token ?</label><input type="password" value={baseApiToken} onChange={(e) => setBaseApiToken(e.target.value)} title="Bearer token cifrado no banco" /></div>
                    <div><label>Usuário</label><input value={baseApiUser} onChange={(e) => setBaseApiUser(e.target.value)} /></div>
                    <div><label>Senha</label><input type="password" value={baseApiPassword} onChange={(e) => setBaseApiPassword(e.target.value)} /></div>
                    <div className="full"><label>Headers JSON ?</label><textarea className="jsonArea" value={baseApiHeaders} onChange={(e) => setBaseApiHeaders(e.target.value)} title={'Ex.: { "Accept": "application/json" }'} /></div>
                    <div className="full"><label>Body JSON</label><textarea className="jsonArea" value={baseApiBody} onChange={(e) => setBaseApiBody(e.target.value)} /></div>
                  </div>
                )}

                {baseType === "nfs" && (
                  <div className="grid2">
                    <div>
                      <label>Servidor / Storage</label>
                      <input
                        value={baseNfsServer}
                        onChange={(e) => setBaseNfsServer(e.target.value)}
                        title="Servidor NFS"
                        placeholder="10.100.58.50"
                      />
                    </div>
                    <div>
                      <label>Export</label>
                      <input
                        value={baseNfsExport}
                        onChange={(e) => setBaseNfsExport(e.target.value)}
                        title="Export NFS, ex.: /1"
                        placeholder="/1"
                      />
                    </div>
                    <div>
                      <label>Caminho</label>
                      <input
                        value={baseNfsPath}
                        onChange={(e) => setBaseNfsPath(e.target.value)}
                        title="Subcaminho dentro do export"
                        placeholder="testdata/clientes.csv"
                      />
                    </div>
                    <div>
                      <label>Versão</label>
                      <input
                        value={baseNfsVersion}
                        onChange={(e) => setBaseNfsVersion(e.target.value)}
                        placeholder="4.1"
                      />
                    </div>
                    <div className="full">
                      <label>Variáveis cofre JSON</label>
                      <textarea
                        className="jsonArea"
                        value={baseNfsVaultVars}
                        onChange={(e) => setBaseNfsVaultVars(e.target.value)}
                        title={'Ex.: { "DATA_PATH": "/shared/testdata/clientes.csv" }'}
                      />
                    </div>
                    <div className="full">
                      <div className="artifactMeta">NFS normalmente não exige usuário e senha neste formulário; o acesso costuma ser controlado pelo export do servidor/storage.</div>
                    </div>
                  </div>
                )}

                {["sqlserver","postgres","mysql","oracle"].includes(baseType) && (
                  <div className="grid2">
                    <div><label>Host ?</label><input value={baseSqlHost} onChange={(e) => setBaseSqlHost(e.target.value)} title="Servidor do banco" /></div>
                    <div><label>Porta</label><input value={baseSqlPort} onChange={(e) => setBaseSqlPort(e.target.value)} /></div>
                    <div><label>Banco</label><input value={baseSqlDatabase} onChange={(e) => setBaseSqlDatabase(e.target.value)} /></div>
                    <div><label>Schema</label><input value={baseSqlSchema} onChange={(e) => setBaseSqlSchema(e.target.value)} /></div>
                    <div><label>Usuário</label><input value={baseSqlUser} onChange={(e) => setBaseSqlUser(e.target.value)} /></div>
                    <div><label>Senha</label><input type="password" value={baseSqlPassword} onChange={(e) => setBaseSqlPassword(e.target.value)} /></div>
                    <div className="full"><label>Query</label><textarea className="jsonArea" value={baseSqlQuery} onChange={(e) => setBaseSqlQuery(e.target.value)} /></div>
                  </div>
                )}

                <div className="switchRow">
                  <div>
                    <strong>Base desmarcada</strong>
                    <p>Se marcada, a base fica salva mas não aparece como ativa na execução.</p>
                  </div>
                  <input type="checkbox" checked={baseUnchecked} onChange={(e) => setBaseUnchecked(e.target.checked)} />
                </div>

                <div className="actionsInline">
                  <button className="secondaryBtn" onClick={saveDataSource} disabled={submittingBase}>
                    {submittingBase ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
                    {editingBaseId ? "Salvar edição" : "Salvar base"}
                  </button>

                  <button className="secondaryBtn" onClick={() => { resetBaseForm(); setShowBaseManager(false); }}>
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {!showBaseManager && (
              <div className="baseList">
                {dataSources.map((ds) => (
                  <div key={ds.id} className="baseItem">
                    <div className="baseItemLeft">
                      {sourceTypeIcon(ds.source_type)}
                      <div>
                        <strong>{ds.name}</strong>
                        <div className="artifactMeta">
                          {ds.source_type} • {ds.data_format} • {ds.is_enabled ? "ativa" : "desmarcada"}
                        </div>
                        {ds.last_test_status && (
                          <div className="artifactMeta">
                            teste: {ds.last_test_status} {ds.last_test_message ? `• ${ds.last_test_message}` : ""}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="actionsInline">
                      <button className="miniBtn" onClick={() => populateBaseForm(ds)} title="Editar">
                        ✎
                      </button>
                      <button className="miniBtn" onClick={() => testDataSource(ds.id)} title="Testar conexão">
                        ?
                      </button>
                      <button className="miniBtn dangerBtn" onClick={() => deleteDataSource(ds.id, ds.name)} title="Deletar">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><Database size={18} /></div>
              <div>
                <h2>Base e recursos da execução</h2>
                <p>A base é opcional. CPU, RAM e disco temporário são definidos por execução.</p>
              </div>
            </div>

            <div className="presetRow">
              <button type="button" className="presetBtn" onClick={() => applyPreset("leve")}>Leve</button>
              <button type="button" className="presetBtn" onClick={() => applyPreset("medio")}>Médio</button>
              <button type="button" className="presetBtn" onClick={() => applyPreset("pesado")}>Pesado</button>
            </div>

            <div className="hintBox">
              Limites atuais na interface: até <b>{SAFE_LIMITS.cpuMax} CPU</b>, <b>{SAFE_LIMITS.ramMax} GiB RAM</b> e <b>{SAFE_LIMITS.diskMax} GiB disco</b>.
            </div>

            <div className="switchRow">
              <div>
                <strong>Usar base cadastrada</strong>
                <p>Desative quando quiser executar só o código.</p>
              </div>
              <input
                type="checkbox"
                checked={useDataSource}
                onChange={(e) => setUseDataSource(e.target.checked)}
              />
            </div>

            <label>Base cadastrada</label>
            <select
              disabled={!useDataSource || !dataSources.filter((ds) => ds.is_enabled).length}
              value={selectedDataSource}
              onChange={(e) => setSelectedDataSource(e.target.value)}
            >
              {dataSources.filter((ds) => ds.is_enabled).map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.id} - {ds.name} ({ds.source_type}/{ds.data_format})
                </option>
              ))}
            </select>

            <div className="grid3">
              <div>
                <label><Cpu size={14} /> CPUs</label>
                <input value={cpus} onChange={(e) => setCpus(e.target.value.replace(/[^\d]/g, ""))} />
              </div>

              <div>
                <label><MemoryStick size={14} /> RAM (Gi)</label>
                <input value={ram} onChange={(e) => setRam(e.target.value.replace(/[^\d]/g, ""))} />
              </div>

              <div>
                <label><HardDrive size={14} /> Disco temp. (Gi)</label>
                <input value={disk} onChange={(e) => setDisk(e.target.value.replace(/[^\d]/g, ""))} />
              </div>
            </div>

            <button className="runBtn" onClick={executeRun} disabled={executing || loadingCatalogs}>
              {executing ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              {executing ? "Executando" : "Executar"}
            </button>
          </div>
        </div>

        <div className="rightColumn">
          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><TerminalSquare size={18} /></div>
              <div>
                <h2>Verbose da execução</h2>
                <p>Saída detalhada da API, stdout, stderr e logs do Job.</p>
              </div>
            </div>

            <JsonPanel title="Resposta da API" data={apiResponse} />
            <TextPanel title="Verbose da execução" data={{ content: verboseOutput }} />
            <TextPanel title="stdout.log" data={stdoutResponse} />
            <TextPanel title="stderr.log" data={stderrResponse} />
            <JsonPanel title="Logs do Job" data={logsResponse} />
          </div>

          <div className="card">
            <div className="sectionTitle">
              <div className="iconBox"><ImageIcon size={18} /></div>
              <div>
                <h2>Resultado visual</h2>
                <p>Artefatos gerados pela execução, com renderização imediata para imagens.</p>
              </div>
            </div>

            <JsonPanel title="result.json" data={resultResponse} />

            <div className="artifactsWrap">
              {artifacts.length === 0 ? (
                <div className="emptyState">
                  Quando o seu código gerar imagens, HTML, JSON ou outros arquivos, eles aparecerão aqui.
                </div>
              ) : (
                artifacts.map((artifact, idx) => (
                  <ArtifactCard
                    key={`${artifact.name}-${idx}`}
                    artifact={artifact}
                    getArtifactUrl={getArtifactUrl}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      {helpModalOpen && (
        <div className="helpModalOverlay" onClick={closeHelpModal}>
          <div className="helpModalCard" onClick={(e) => e.stopPropagation()}>
            <div className="helpModalHeader">
              <strong>{helpModalTitle}</strong>
              <button type="button" className="secondaryBtn" onClick={closeHelpModal}>Fechar</button>
            </div>
            <pre className="helpModalText">{helpModalText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
