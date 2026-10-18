import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2,
  ChevronLeft, ChevronRight, Clock3, Database, ExternalLink, FileText,
  Gauge, Layers3, LayoutDashboard, LogOut, RefreshCw, Search, Server,
  Settings2, ShieldCheck, TerminalSquare, Users, Workflow, XCircle
} from 'lucide-react';
import './AdminDashboard.css';

const API = '/api';
const STATUS_LABEL = {running:'Executando',completed:'Concluído',failed:'Falha',pending:'Pendente',unknown:'Desconhecido'};
const LANG_LABEL = {python:'Python',r:'R','python+r':'Python + R',hybrid:'Híbrido'};
const SECTIONS = [
  {id:'overview',name:'Visão geral',Icon:LayoutDashboard},
  {id:'jobs',name:'Execuções',Icon:Activity},
  {id:'workers',name:'Infraestrutura',Icon:Server},
  {id:'workflow',name:'Workflows',Icon:Workflow,disabled:true},
  {id:'users',name:'Usuários',Icon:Users,disabled:true},
  {id:'settings',name:'Configurações',Icon:Settings2,disabled:true},
];
const fmtDate = (v) => {
  if(!v) return '—';
  // PostgreSQL uses naive timestamps; retain their wall clock rather than silently assign UTC.
  const t = String(v).replace('T',' ').slice(0,19);
  const [d,time] = t.split(' ');
  const [y,m,day] = (d||'').split('-');
  return y && m && day ? `${day}/${m}/${y} ${time||''}` : t;
};
const int = (n) => Number(n || 0).toLocaleString('pt-BR');
const percent = (n,total) => total ? Math.min(100,Math.max(0,Math.round(Number(n||0)*100/total))) : 0;
async function adminGet(path) {
  const r=await fetch(`${API}${path}`,{credentials:'include'});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(typeof body.detail==='string'?body.detail:`HTTP ${r.status}`);
  return body;
}
function Metric({label,value,icon:Icon,sub,tone}) {
  return <article className="ao-metric"><div className="ao-metric-top"><span>{label}</span><span className={`ao-metric-icon ao-tone-${tone||'blue'}`}><Icon size={19}/></span></div>
    <strong>{value}</strong><small>{sub}</small></article>;
}
function StatusPill({status}) {return <span className={`ao-pill ao-pill-${status||'unknown'}`}><span className="ao-dot"/>{STATUS_LABEL[status]||status||'—'}</span>}
function Donut({data}) {
  const entries=Object.entries(data||{}).filter(([,v])=>Number(v)>0);
  const total=entries.reduce((sum,[,v])=>sum+Number(v),0);
  const palette=['#5277ea','#22b4a6','#a989f5','#f1b65c','#f17e83'];
  let start=0;
  const stops=entries.map(([name,v],i)=>{const a=start;start+=Number(v)*100/total;return {name,v,a,b:start,color:palette[i%palette.length]}});
  const background=total ? `conic-gradient(${stops.map(s=>`${s.color} ${s.a}% ${s.b}%`).join(',')})` : '#e9eef7';
  return <div className="ao-donut-layout"><div className="ao-donut" style={{background}}><div className="ao-donut-center"><strong>{int(total)}</strong><span>Execuções</span></div></div>
    <div className="ao-legend">{stops.length ? stops.map(s=><div key={s.name}><i style={{background:s.color}}/><span>{LANG_LABEL[s.name]||s.name}</span><b>{int(s.v)}</b></div>) : <span className="ao-muted">Nenhuma execução registrada</span>}</div></div>;
}
function ProgressBars({counts}) {
  const entries=Object.entries(counts||{}).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(1,...entries.map(x=>Number(x[1])));
  return <div className="ao-bars">{entries.length?entries.map(([key,n],i)=><div className="ao-barline" key={key}><span>{STATUS_LABEL[key]||key}</span><div className="ao-track"><div style={{width:`${Number(n)*100/max}%`,background:['#5376e8','#2bb7aa','#f18a8f','#e3ac57'][i%4]}}/></div><b>{int(n)}</b></div>):<div className="ao-empty">Sem dados para exibir.</div>}</div>;
}
function WorkerList({workers}) {
  if(!workers?.length) return <div className="ao-empty">Nenhum nó retornado pela API.</div>;
  return <div className="ao-worker-list">{workers.map(w=><article className="ao-worker" key={w.name}><div className="ao-worker-icon"><Server size={18}/></div><div className="ao-worker-detail"><strong>{w.name}</strong><span>{w.analytics_worker?'Worker de processamento':'Control plane / outro nó'}</span></div><StatusPill status={w.ready?'completed':'failed'}/></article>)}</div>;
}
function NodeMetrics({nodes}) {
  if (!nodes?.length) return <div className="ao-empty">Nenhuma métrica de nó disponível.</div>;
  return <div className="ao-table-scroll"><table className="ao-live-table"><thead><tr><th>Nó</th><th>CPU atual</th><th>Memória atual</th></tr></thead><tbody>
    {nodes.map(n=><tr key={n.name}><td><strong>{n.name}</strong></td><td>{Number(n.cpu_millicores||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} m</td><td>{Number(n.memory_mib||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} MiB</td></tr>)}
  </tbody></table></div>;
}
function PodMetrics({pods}) {
  if (!pods?.length) return <div className="ao-empty">Nenhum Pod de processamento com métricas disponíveis agora. Jobs concluídos não possuem métricas instantâneas.</div>;
  return <div className="ao-table-scroll"><table className="ao-live-table"><thead><tr><th>Pod</th><th>CPU atual</th><th>Memória atual</th></tr></thead><tbody>
    {pods.map(p=><tr key={`${p.namespace}/${p.name}`}><td><strong>{p.name}</strong><small>{p.namespace}</small></td><td>{Number(p.cpu_millicores||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} m</td><td>{Number(p.memory_mib||0).toLocaleString('pt-BR',{maximumFractionDigits:1})} MiB</td></tr>)}
  </tbody></table></div>;
}
export default function AdminDashboard({currentUser,onWorkspace,onLogout}) {
  const [section,setSection]=useState('overview');
  const [overview,setOverview]=useState(null);
  const [workers,setWorkers]=useState([]);
  const [health,setHealth]=useState(null);
  const [jobs,setJobs]=useState({items:[],total:0});
  const [metricsSummary,setMetricsSummary]=useState(null);
  const [metricsNodes,setMetricsNodes]=useState([]);
  const [jobPodMetrics,setJobPodMetrics]=useState([]);
  const [metricsError,setMetricsError]=useState('');
  const [status,setStatus]=useState('');
  const [language,setLanguage]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(1);
  const [updated,setUpdated]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{
    try {
      const params=new URLSearchParams({page:String(page),page_size:'20'});
      if(status)params.set('status',status);
      if(language)params.set('language',language);
      const [o,w,h,j]=await Promise.all([
        adminGet('/admin/overview'),adminGet('/admin/workers'),
        adminGet('/admin/health'),adminGet(`/admin/jobs?${params}`),
      ]);
      setOverview(o);setWorkers(w.items||[]);setHealth(h);setJobs(j);
      setError('');setUpdated(new Date());
      // Falha pontual na Metrics API nao interrompe o dashboard administrativo.
      const [summaryResult,nodesResult,podsResult]=await Promise.allSettled([
        adminGet('/metrics/summary'),adminGet('/metrics/nodes'),
        adminGet('/metrics/pods?namespace=analytics-jobs'),
      ]);
      setMetricsSummary(summaryResult.status==='fulfilled'?summaryResult.value:null);
      setMetricsNodes(nodesResult.status==='fulfilled'?(nodesResult.value.items||[]):[]);
      setJobPodMetrics(podsResult.status==='fulfilled'?(podsResult.value.items||[]):[]);
      setMetricsError([summaryResult,nodesResult,podsResult].some(x=>x.status==='rejected')?'Coleta de métricas parcialmente indisponível.':'');
    }catch(e){setError(e.message)}finally{setLoading(false)}
  },[page,status,language]);
  useEffect(()=>{reload();const timer=setInterval(reload,15000);return()=>clearInterval(timer)},[reload]);
  const byStatus=overview?.by_status||{};
  const byLanguage=overview?.by_language||{};
  const visibleJobs=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (jobs.items||[]).filter(j=>!q||[j.id,j.run_name,j.job_name,j.username,j.node_name].some(x=>String(x??'').toLowerCase().includes(q)));
  },[jobs,search]);
  const workerNodes=workers.filter(w=>w.analytics_worker);
  const pageCount=Math.max(1,Math.ceil((jobs.total||0)/20));
  return <div className="ao-app">
    <aside className="ao-sidebar">
      <div className="ao-brand"><div className="ao-brand-mark"><Layers3 size={23}/></div><div><strong>Analytics</strong><small>ADMIN CONSOLE</small></div></div>
      <div className="ao-menu-title">GERENCIAMENTO</div>
      <nav aria-label="Navegação administrativa" className="ao-nav">{SECTIONS.map(({id,name,Icon,disabled})=><button key={id} type="button" className={`ao-nav-item ${section===id?'ao-active':''}`} disabled={disabled} title={disabled?'Em desenvolvimento':name} onClick={()=>setSection(id)}><Icon size={18}/><span>{name}</span>{disabled&&<span className="ao-soon">Breve</span>}</button>)}</nav>
      <div className="ao-sidebar-bottom"><div className="ao-sidebar-cluster"><span className="ao-pulse"/> Ambiente Analytics <small>Monitoramento ativo</small></div>
        <button className="ao-workspace" onClick={onWorkspace}><TerminalSquare size={17}/> Ir ao Workspace <ExternalLink size={14}/></button>
      </div>
    </aside>
    <div className="ao-main">
      <header className="ao-topbar"><div className="ao-breadcrumb">Plataforma Analytics <ChevronRight size={14}/> <strong>{SECTIONS.find(s=>s.id===section)?.name}</strong></div>
        <div className="ao-top-actions"><div className="ao-env"><span className="ao-pulse"/> Cluster Analytics</div><span className="ao-top-separator"/><div className="ao-avatar">{(currentUser?.display_name||currentUser?.username||'A').trim().slice(0,1).toUpperCase()}</div><div className="ao-user"><strong>{currentUser?.display_name||currentUser?.username||'Administrador'}</strong><small>Administrador</small></div><button className="ao-icon-btn" title="Sair" onClick={onLogout}><LogOut size={17}/></button></div></header>
      <main className="ao-content">
        <div className="ao-titlebar"><div><div className="ao-eyebrow"><ShieldCheck size={14}/> ÁREA ADMINISTRATIVA</div><h1>{section==='overview'?'Visão geral':section==='jobs'?'Execuções': 'Infraestrutura'}</h1><p>{section==='overview'?'Acompanhe a saúde da plataforma e o processamento distribuído em tempo real.':section==='jobs'?'Consulte as execuções registradas em toda a plataforma.':'Verifique a disponibilidade dos nós Kubernetes.'}</p></div><div className="ao-title-actions"><span className="ao-refresh-time">{updated?`Atualizado às ${updated.toLocaleTimeString('pt-BR')}`:'Carregando dados'}</span><button className="ao-refresh" onClick={reload}><RefreshCw size={16}/> Atualizar</button></div></div>
        {error&&<div className="ao-error"><AlertTriangle size={17}/> Erro ao carregar dados: {error}</div>}
        {metricsError&&<div className="ao-metrics-warning"><AlertTriangle size={15}/>{metricsError}</div>}
        {loading && !overview&&<div className="ao-loading">Consultando PostgreSQL e Kubernetes...</div>}
        {(section==='overview'||section==='jobs')&&<>
          <div className="ao-metrics"><Metric label="Total de execuções" value={overview?int(overview.total):'—'} icon={Layers3} sub="Registros históricos"/><Metric label="Em execução" value={overview?int(byStatus.running):'—'} icon={Activity} tone="cyan" sub="Processamentos ativos"/><Metric label="Concluídas" value={overview?int(byStatus.completed):'—'} icon={CheckCircle2} tone="green" sub="Execuções finalizadas"/><Metric label="Com falha" value={overview?int(byStatus.failed):'—'} icon={AlertTriangle} tone="red" sub="Demandam investigação"/></div>
        </>}
        {(section==='overview'||section==='workers')&&<div className="ao-metrics ao-live-cards">
          <Metric label="Nós monitorados" value={metricsSummary?int(metricsSummary.nodes_count):'—'} icon={Server} tone="cyan" sub="Com métricas de CPU e memória"/>
          <Metric label="CPU do cluster" value={metricsSummary?`${Number(metricsSummary.cpu_millicores).toLocaleString('pt-BR',{maximumFractionDigits:1})} m`:'—'} icon={Gauge} sub="Uso instantâneo em millicores"/>
          <Metric label="Memória do cluster" value={metricsSummary?`${Number(metricsSummary.memory_mib/1024).toLocaleString('pt-BR',{maximumFractionDigits:2})} GiB`:'—'} icon={Database} tone="green" sub="Uso instantâneo em GiB"/>
          <Metric label="Pods monitorados" value={metricsSummary?int(metricsSummary.pods_count):'—'} icon={Activity} sub="Pods com métricas disponíveis"/>
        </div>}
        {section==='overview'&&<>
          <div className="ao-grid-charts"><section className="ao-panel"><div className="ao-panel-head"><div><h2>Execuções por linguagem</h2><p>Distribuição dos processamentos registrados</p></div><span className="ao-panel-icon"><BarChart3 size={18}/></span></div><Donut data={byLanguage}/></section>
            <section className="ao-panel"><div className="ao-panel-head"><div><h2>Estado das execuções</h2><p>Volume por situação no histórico</p></div><span className="ao-panel-icon"><Gauge size={18}/></span></div><ProgressBars counts={byStatus}/><div className="ao-chart-foot"><Clock3 size={15}/> Duração média: <strong>{overview?.average_duration_seconds==null?'Indisponível':`${Number(overview.average_duration_seconds).toLocaleString('pt-BR')} s`}</strong></div></section></div>
          <div className="ao-grid-lower"><section className="ao-panel"><div className="ao-panel-head"><div><h2>Infraestrutura Kubernetes</h2><p>Estado de disponibilidade dos nós</p></div><button className="ao-link" onClick={()=>setSection('workers')}>Ver todos <ChevronRight size={15}/></button></div><WorkerList workers={workers}/><div className="ao-chart-foot"><Server size={15}/> Workers prontos: <strong>{workerNodes.filter(w=>w.ready).length}/{workerNodes.length}</strong><span className="ao-health-note">CPU/RAM: métricas em tempo real</span></div></section>
            <section className="ao-panel ao-panel-health"><div className="ao-panel-head"><div><h2>Saúde dos serviços</h2><p>Verificações dos componentes principais</p></div><span className="ao-panel-icon"><Activity size={18}/></span></div>
              <div className="ao-health-row"><Database size={17}/><span>PostgreSQL</span><span className="ao-health-value">{String(health?.database??'Não verificado')}</span></div>
              <div className="ao-health-row"><Server size={17}/><span>Kubernetes</span><span className="ao-health-value">{String(health?.kubernetes??'Não verificado')}</span></div>
              <div className="ao-health-row"><ShieldCheck size={17}/><span>Conexão API</span><span className="ao-health-value">{error?'Com falha':'Conectada'}</span></div>
              <p className="ao-health-caption">Métricas obtidas da Metrics API Kubernetes. Coleta instantânea, sem histórico.</p>
            </section></div>
        </>}
        {section==='overview'&&<section className="ao-panel ao-live-panel"><div className="ao-panel-head"><div><h2>Consumo dos nós Kubernetes</h2><p>Métricas atuais dos quatro servidores</p></div><span className="ao-panel-icon"><Gauge size={18}/></span></div><NodeMetrics nodes={metricsNodes}/></section>}
        {section==='workers'&&<section className="ao-panel"><div className="ao-panel-head"><div><h2>Nós do cluster</h2><p>Informações obtidas diretamente da API Kubernetes</p></div><span className="ao-panel-icon"><Server size={18}/></span></div><WorkerList workers={workers}/><NodeMetrics nodes={metricsNodes}/><p className="ao-health-caption">Consumo instantâneo dos nós obtido da Metrics API. Valores absolutos, não percentuais.</p></section>}
        {section==='jobs'&&<section className="ao-panel ao-live-panel"><div className="ao-panel-head"><div><h2>Consumo dos Pods de processamento</h2><p>Namespace analytics-jobs · métricas instantâneas</p></div><span className="ao-panel-icon"><Activity size={18}/></span></div><PodMetrics pods={jobPodMetrics}/></section>}
        {(section==='overview'||section==='jobs')&&<section className="ao-panel ao-jobs-panel"><div className="ao-panel-head"><div><h2>Histórico de execuções</h2><p>Execuções globais de Python e R</p></div><span className="ao-total">{int(jobs.total)} registros</span></div>
          <div className="ao-filters"><div className="ao-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar nesta página..." aria-label="Pesquisar execuções na página atual"/></div>
            <select value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}} aria-label="Filtrar status"><option value="">Todos os status</option><option value="running">Executando</option><option value="completed">Concluído</option><option value="failed">Falha</option></select>
            <select value={language} onChange={e=>{setLanguage(e.target.value);setPage(1)}} aria-label="Filtrar linguagem"><option value="">Todas linguagens</option><option value="python">Python</option><option value="r">R</option></select></div>
          <div className="ao-table-scroll"><table><thead><tr><th>ID</th><th>Execução</th><th>Usuário</th><th>Linguagem</th><th>Worker</th><th>Status</th><th>Início</th></tr></thead><tbody>{visibleJobs.length?visibleJobs.map(j=><tr key={j.id}><td className="ao-id">#{j.id}</td><td><div className="ao-jobname" title={j.job_name}>{j.run_name||j.job_name}</div><small>{j.job_name}</small></td><td>{j.username||'—'}</td><td><span className="ao-lang">{LANG_LABEL[j.language]||j.language||'—'}</span></td><td>{j.node_name||'—'}</td><td><StatusPill status={j.status}/></td><td>{fmtDate(j.started_at)}</td></tr>):<tr><td colSpan="7" className="ao-empty">Nenhuma execução encontrada.</td></tr>}</tbody></table></div>
          <div className="ao-table-footer"><span>Exibindo até 20 resultados por página. Pesquisa textual restrita à página atual.</span><div className="ao-pagination"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17}/></button><strong>{page} / {pageCount}</strong><button disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)}><ChevronRight size={17}/></button></div></div>
        </section>}
        <footer className="ao-footer">Analytics Admin Console <span>•</span> Dados reais de PostgreSQL e Kubernetes <span>•</span> Atualização automática a cada 15 segundos <span>•</span> Somente leitura</footer>
      </main>
    </div>
  </div>;
}
