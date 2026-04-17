# K8s Analytics Platform

> Plataforma analítica para execução efêmera de código **Python** e **R** em containers isolados no Kubernetes, com frontend web, API de orquestração, geração de artefatos e controle de recursos por execução.

---

## Visão geral

O **K8s Analytics Platform** foi criado para permitir que desenvolvedores, analistas e cientistas de dados executem código de forma controlada em um cluster Kubernetes, com foco em:

- isolamento por execução
- controle de CPU, memória e armazenamento efêmero
- suporte a múltiplas linguagens
- geração e visualização de artefatos
- backend orientado a jobs efêmeros
- interface web moderna para disparo e acompanhamento

Cada execução gera um **Job** no Kubernetes. Esse Job sobe um container isolado, executa o código solicitado, salva logs e resultados, e depois termina.

---

## Status do projeto

### Fase atual

**MVP funcional / Alpha técnico**

O projeto já possui fluxo funcional de ponta a ponta para execução de código e renderização de resultados, mas ainda está em fase de consolidação de arquitetura, principalmente na parte de distribuição entre nós workers e uso de armazenamento compartilhado.

### O que já está funcionando

- API em **FastAPI**
- frontend moderno em **React**
- worker de execução para **Python**
- worker de execução para **R**
- criação de **Jobs efêmeros** no Kubernetes
- geração de `result.json`
- geração de `stdout.log` e `stderr.log`
- geração de artefatos visuais como imagens `.png`
- visualização e download de artefatos pela interface
- cadastro de **code sources** inline
- cadastro de **data sources**
- execução com ou sem base de dados
- definição de recursos por execução:
  - CPU
  - RAM
  - armazenamento efêmero
- limpeza automática dos jobs concluídos via TTL

### O que está parcialmente pronto

- execução via interface para Python
- execução via interface para R
- distribuição de jobs para workers do cluster
- publicação de imagens em registry externo
- versionamento centralizado do projeto em GitHub/GitLab

### O que ainda falta

- suporte completo a **GitLab** como fonte de código
- fluxo **Python + R** na mesma execução
- editor estilo **VS Code / Monaco Editor**
- monitoramento de status em tempo real na interface
- fila mais amigável para execuções pendentes
- armazenamento compartilhado entre nós
- eliminação definitiva da dependência de `hostPath`
- autenticação/autorização de usuários
- pipeline CI/CD completo

---

## Arquitetura atual

### Componentes principais

- **Frontend moderno**
  - React
  - interface para cadastro, execução e visualização de resultados

- **API**
  - FastAPI
  - orquestra criação de Jobs no Kubernetes
  - registra metadados de execução
  - serve logs, resultados e artefatos

- **Worker Python**
  - executa código Python em container efêmero
  - gera logs, `result.json` e artefatos

- **Worker R**
  - executa código R em container efêmero
  - gera logs, `result.json` e artefatos

- **PostgreSQL**
  - armazena data sources, code sources e job runs

- **Kubernetes**
  - responsável pela orquestração dos jobs e workloads persistentes

---

## Fluxo de execução

1. O usuário acessa a interface web.
2. Seleciona a linguagem, define recursos e informa o código.
3. O frontend chama a API.
4. A API registra a origem do código e prepara o Job.
5. O Job sobe um container efêmero no cluster.
6. O worker executa o código.
7. São gerados:
   - `stdout.log`
   - `stderr.log`
   - `result.json`
   - artefatos, quando aplicável
8. A API disponibiliza esses resultados para o frontend.
9. O Job termina e é limpo após o TTL.

---

## Estrutura do projeto

```text
/opt/analytics
├── api/
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── run-python-job-v2.sh
│   ├── run-r-job-v1.sh
│   └── api-deployment.yaml
│
├── frontend-react/
│   ├── src/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── frontend-modern.yaml
│
├── worker-python/
│   ├── app/
│   ├── Dockerfile
│   └── run-python-job-v2.sh
│
├── worker-r/
│   ├── app/
│   ├── Dockerfile
│   └── run-r-job-v1.sh
│
├── generated-jobs/
├── k8s-output/
├── code-runs/
├── code-runs-r/
└── testdata/
