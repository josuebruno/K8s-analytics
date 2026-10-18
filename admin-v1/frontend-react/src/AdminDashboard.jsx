import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, RefreshCcw, Server, ShieldCheck } from 'lucide-react';
import './AdminDashboard.css';

const API = '/api';
const STATUSES = ['', 'running', 'completed', 'failed'];

async function adminGet(url) {
  const response = await fetch(API + url, { credentials: 'include' });
  let data = {};
  try { data = await response.json(); } catch { /* unexpected upstream response */ }
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [health, setHealth] = useState(null);
  const [jobs, setJobs] = useState({ items: [], total: 0 });
  const [status, setStatus] = useState('');
  const [language, setLanguage] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);
  const reload = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (status) params.set('status', status);
      if (language) params.set('language', language);
      const [o, w, h, j] = await Promise.all([
        adminGet('/admin/overview'), adminGet('/admin/workers'),
        adminGet('/admin/health'), adminGet(`/admin/jobs?${params}`),
      ]);
      setOverview(o); setWorkers(w.items || []); setHealth(h); setJobs(j);
      setError(''); setUpdated(new Date());
    } catch (err) { setError(err.message); }
  }, [page, status, language]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [reload]);

  const statusCounts = overview?.by_status || {};
  const languageCounts = overview?.by_language || {};
  const cardData = [
    ['Total de execuções', overview?.total ?? '—'],
    ['Em execução', statusCounts.running ?? 0],
    ['Concluídos', statusCounts.completed ?? 0],
    ['Falhas', statusCounts.failed ?? 0],
    ['Tempo médio (s)', overview?.average_duration_seconds ?? '—'],
    ['Workers prontos', `${workers.filter(w => w.analytics_worker && w.ready).length}/${workers.filter(w => w.analytics_worker).length}`],
  ];

  return <main className="adm-root">
    <header className="adm-header">
      <div><div className="adm-eyebrow"><ShieldCheck size={15}/> ÁREA RESTRITA</div>
        <h1>Administração e Observabilidade</h1>
        <p>Visão global dos processamentos Python, R e infraestrutura Kubernetes.</p></div>
      <button className="adm-button" onClick={reload}><RefreshCcw size={15}/> Atualizar</button>
    </header>
    {error && <div className="adm-error"><AlertCircle size={18}/><span>{error}</span></div>}
    <div className="adm-meta">Atualização automática a cada 15 segundos {updated ? `· Última consulta ${updated.toLocaleTimeString('pt-BR')}` : ''}</div>
    <div className="adm-cards">{cardData.map(([label, value]) =>
      <div className="adm-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="adm-columns">
      <section className="adm-panel"><h2><Activity size={18}/> Execuções por linguagem</h2>
        {Object.entries(languageCounts).length ? Object.entries(languageCounts).map(([key, n]) =>
          <div className="adm-meter" key={key}><span>{key}</span><div className="adm-track"><div style={{width: `${overview?.total ? 100*n/overview.total : 0}%`}} /></div><b>{n}</b></div>) : <p>Sem registros.</p>}
      </section>
      <section className="adm-panel"><h2><Server size={18}/> Nós Kubernetes</h2>
        {workers.map(w => <div className="adm-worker" key={w.name}>
          <div><strong>{w.name}</strong><small>{w.analytics_worker ? 'Worker Analytics' : 'Controle/outro nó'}</small></div>
          <span className={w.ready ? 'adm-status-ok' : 'adm-status-fail'}>{w.ready ? 'Ready' : 'NotReady'}</span>
        </div>)}
        <small>Métricas de uso CPU/RAM indisponíveis até ativação da Metrics API. Capacidade não equivale a consumo.</small>
      </section>
    </div>
    <section className="adm-panel adm-jobs">
      <div className="adm-table-title"><h2><CheckCircle2 size={18}/> Execuções recentes</h2><span>{jobs.total} registros</span></div>
      <div className="adm-filters">
        <select value={status} onChange={e => {setStatus(e.target.value); setPage(1)}} aria-label="Filtrar status">
          {STATUSES.map(s => <option key={s} value={s}>{s || 'Todos os status'}</option>)}
        </select>
        <select value={language} onChange={e => {setLanguage(e.target.value); setPage(1)}} aria-label="Filtrar linguagem">
          <option value="">Todas as linguagens</option><option value="python">Python</option><option value="r">R</option>
        </select>
      </div>
      <div className="adm-table-scroll"><table><thead><tr><th>ID</th><th>Job</th><th>Usuário</th><th>Linguagem</th><th>Nó</th><th>Status</th><th>Início</th><th>Fim</th></tr></thead>
        <tbody>{jobs.items?.length ? jobs.items.map(j => <tr key={j.id}>
          <td>#{j.id}</td><td title={j.job_name}>{j.run_name || j.job_name}</td><td>{j.username || '—'}</td>
          <td>{j.language}</td><td>{j.node_name || '—'}</td><td><span className={`adm-pill adm-${j.status}`}>{j.status}</span></td>
          <td>{formatDate(j.started_at)}</td><td>{formatDate(j.finished_at)}</td>
        </tr>) : <tr><td colSpan="8">Nenhuma execução encontrada.</td></tr>}</tbody></table></div>
      <div className="adm-pager"><button disabled={page === 1} onClick={() => setPage(p => p-1)}>Anterior</button>
        <span>Página {page} de {Math.max(1, Math.ceil((jobs.total || 0)/20))}</span>
        <button disabled={page*20 >= jobs.total} onClick={() => setPage(p => p+1)}>Próxima</button></div>
    </section>
    <footer className="adm-meta">Banco: {health?.database || '—'} · Kubernetes: {health?.kubernetes || '—'} · Painel somente leitura</footer>
  </main>;
}
