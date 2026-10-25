# HiLighter - Ferramenta de gerenciamento de notas destacadas para Obsidian

[![Plugin Version](https://img.shields.io/github/v/release/PandoraReads/HiLighter?label=Version&color=blue)](https://github.com/pandorareads/hilighter/releases)
[![Obsidian Version](https://img.shields.io/badge/Obsidian-v1.7.2%2B-purple)](https://obsidian.md)

**English** | [简体中文](./README_ZH.md) | [日本語](./README_JA.md) | [한국어](./README_KO.md) | [Français](./README_FR.md) | [Deutsch](./README_DE.md) | [Español](./README_ES.md) | **Português** | [Русский](./README_RU.md)

---

**HiLighter** é um plugin do Obsidian focado no gerenciamento de notas destacadas. Ele transforma o conteúdo destacado em cartões de notas fáceis de gerenciar, com suporte a anotações em várias cores, análise por IA e busca inteligente, tornando a organização das suas notas mais eficiente. Funciona com Markdown, PDF e EPUB.

![screenshot1](screenshots/screenshot1.png)

## ✨ Recursos principais

### 🎨 Gerenciamento de cartões de notas destacadas
*   **Gerenciamento na barra lateral**: Agrega o conteúdo `<mark>` destacado do documento atual ou de todo o vault, com **navegação instantânea** ao texto original ao clicar em um cartão.
*   **Filtragem multidimensional**:
    *   **Filtro por cor**: Categorização rápida pelas quatro cores de destaque: amarelo, rosa, azul e verde.
    *   **Busca por palavra-chave**: Filtragem em tempo real do conteúdo das notas pela barra de busca no topo.
*   **Inteligência com IA**:
    *   **Tradução com IA (Languages)**: Tradução precisa das frases destacadas com um clique.
    *   **Pesquisa com IA (Microscope)**: Vários modelos de prompts de pesquisa integrados (análise filosófica, resumo conciso, análise crítica) e suporte a **prompts de pesquisa personalizados** — adicione, edite e alterne livremente entre prompts para diferentes cenários de leitura aprofundada.
*   **Interação flexível**:
    *   **Edição rápida**: Clique no ícone de lápis para editar as notas diretamente no cartão, com altura autoajustável.
    *   **Sistema de tags**: Suporte a tags personalizadas com algoritmo de recomendação inteligente integrado.
    *   **Navegação da coleção**: Alterne com um clique para o modo de tela cheia "Card Studio" para gerenciar suas inspirações de forma centralizada.
*   **Gerenciamento dos cartões de notas**:
    *   **Localizar o texto original**: Clique em um cartão para pular instantaneamente à posição destacada na nota de origem e recuperar rapidamente o contexto.
    *   **Tags de classificação**: Adicione tags a cada cartão para uma organização estruturada, com operações de tags em lote.
    *   **Exclusão em lote**: Ative o modo de lote, selecione vários cartões e exclua-os com um clique, para uma limpeza eficiente.

![screenshot2](screenshots/card-studio.png)

### 📄 Anotações em PDF (novo na 2.5)
*   **Destacar dentro de PDFs**: Selecione texto em qualquer PDF e escolha uma cor — uma marca translúcida de marca-texto aparece na página e um cartão de nota é criado instantaneamente; suas notas, tags, revisão com flashcards e mapas mentais funcionam exatamente como nos destaques de Markdown.
*   **Marcas persistentes**: Cada destaque é ancorado à geometria da página, então as marcas sobrevivem à virada de páginas, ao fechar e reabrir o arquivo, ao zoom e à sincronização do vault entre dispositivos.
*   **Sincronização bidirecional com os cartões**: Excluir um cartão faz sua marca no PDF desaparecer imediatamente; trocar a cor de um cartão atualiza a marca instantaneamente.
*   **Pular para a frase exata**: Clique em um cartão para rolar direto até a frase destacada no PDF, com um breve flash de localização.

![pdf](screenshots/pdf-highlight.png)

### 📖 Leitura e destaque de EPUB (novo na 2.6)
*   **Leia epubs do vault**: clique em qualquer arquivo `.epub` para abri-lo no leitor do HiLighter (ative «Detectar todas as extensões de arquivo» em Configurações → Arquivos e links, ou use o comando *Abrir livro EPUB*). A posição de leitura é lembrada por livro.
*   **Destaque e anote**: selecione texto e destaque em quatro cores no mesmo menu — tradução e pesquisa com IA incluídas. As marcas são ancoradas por CFI e sobrevivem a reaberturas, viradas de página e sincronizações; excluir ou recolorir um cartão atualiza a página instantaneamente.
*   **Os cartões localizam o original**: cada destaque vira um cartão; clique para voltar à frase exata com um flash de localização.
*   **Barra do leitor**: sumário suspenso para pular capítulos, salto de página com números gerados automaticamente e favoritos (adicionar a página atual, voltar pela lista, remover quando quiser).
*   **Dois modos de leitura**: passagem de página horizontal (botões ou deslizar) ou rolagem vertical contínua — alterne a qualquer momento; sua posição é preservada.

### 🧠 Mapas mentais (novo na 2.4)
*   **Geração com um clique**: Importe todos os destaques de qualquer arquivo como um mapa mental — agrupados por títulos do documento, cor do destaque, tag ou ordem simples.
*   **Edição estilo Xmind**: Arraste tópicos para mudar a hierarquia ou a ordem, atalhos Tab/Enter/Delete, edição em linha com duplo clique, recolher/expandir ramificações, desfazer/refazer e linhas de associação entre dois tópicos quaisquer.
*   **9 estruturas**: Mapa mental equilibrado, diagrama lógico (direita/esquerda), organograma, linhas do tempo horizontal/vertical, espinha de peixe e organização de catálogo — alternáveis a qualquer momento.
*   **6 temas de estilo × 8 paletas de cores**: Formas e espessuras de linha (curvas, retas, linhas de ramificação em arco-íris) combinadas com esquemas de cores completos (fundo, preenchimento/borda dos nós com bordas que clareiam por nível, além de uma opção colorida que conserva as cores dos cartões).
*   **Resumos e notas**: Enquadre tópicos com nós de resumo, anexe suas notas a qualquer tópico e volte direto ao destaque de origem.
*   **Importação e exportação**: Abra arquivos `.xmind` diretamente; exporte para PNG, `.xmind` (reabível no Xmind), um esboço Markdown ou um quadro `.canvas` do Obsidian.

![mindmap](screenshots/mindmap.png)

### ⚡ Revisão com flashcards (FSRS)
*   **Repetição espaçada**: O agendamento FSRS integrado transforma os cartões de destaque em flashcards, com uma fila de vencidos e um status de revisão por cartão.
*   **Sessão de revisão focada**: Vire os cartões com Espaço, avalie a lembrança de 1 a 4 (Errei/Difícil/Bom/Fácil), pule ou arquive — tudo pelo teclado.
*   **Dados de revisão**: Contadores de cartões vencidos/novos na barra do estúdio, além de estatísticas de revisão no painel de estatísticas.

---

## 🚀 Início rápido

### Instalação
1. **Instalação manual (recomendada):**
    *   Obtenha os três arquivos principais da versão mais recente: `main.js`, `manifest.json` e `styles.css`.
    *   Coloque-os na pasta do seu vault: `.obsidian/plugins/hilighter/`.
    *   Ative o plugin em Configurações > Plugins de terceiros.
2. **Plugins da comunidade:** Pesquise `HiLighter` no navegador de plugins comunitários do Obsidian e instale-o diretamente.

### Configuração básica
1.  **API LLM de IA (importante)**: Para usar a tradução por IA e a pesquisa por IA, configure uma API LLM nas configurações do plugin. Compatível com provedores populares, incluindo DeepSeek, Google Gemini e Volcano Engine (Ark).
2.  **Ícone do ribbon**: Você pode controlar se o ícone de notas destacadas da barra lateral aparece nas configurações.

---

## 🔄 Sincronização de dados

O HiLighter armazena os destaques em um IndexedDB por dispositivo, mas pode sincronizá-los entre dispositivos por meio de um arquivo do vault (padrão `.hilighter/sync-data.json`). Ative a **Sincronização** nas configurações e deixe o **iCloud** ou o **Obsidian Sync** sincronizar esse arquivo.

- **Importação automática**: o plugin monitora o arquivo de sincronização e mescla automaticamente as alterações de outros dispositivos (~30 s de polling + ao focar a janela).
- **Exportação automática**: as alterações locais são exportadas de volta (debounced ~20 s), mesclando antes o arquivo remoto para não sobrescrever os dados de outros dispositivos.
- **As exclusões se propagam** por meio de tombstones leves (limpos após 30 dias).
- **Somente adicionar/atualizar**: a sincronização mescla linhas, mas nunca exclui linhas que não tenham sido explicitamente marcadas como tombstone; não lê as cópias `*-conflicted-*` do Obsidian Sync.

Você ainda pode disparar a sincronização manualmente com os comandos **Exportar para o vault** / **Importar do vault**.

### Deep links

`obsidian://hilighter?op=...` suporta:

| op | ação |
|---|---|
| `sync-import` | importar do arquivo de sincronização |
| `sync-export` | exportar para o arquivo de sincronização |
| `sync` | importar e depois exportar |
| `open-studio` | abrir o Card Studio |
| `open-view` | abrir a barra lateral de destaques (adicione `&side=main` para a área principal) |

Útil a partir de Atalhos do iOS e outros aplicativos. Sem o parâmetro `vault=`, a URL mira o vault ativo mais recente.

---

## 🛠 Desenvolvimento e build

Desenvolvedores são bem-vindos a contribuir para melhorar este projeto!

*   **Requisitos**: NodeJS (v16+)
*   **Instalar dependências**: `npm install`
*   **Modo de desenvolvimento**: `npm run dev`
*   **Build de produção**: `npm run build`

---

## ❤️ Apoio e feedback

Se você gosta deste plugin, pode demonstrar seu apoio por meio de:

*   **Seguir a conta oficial**: 潘多拉的数字花园 (Pandora's Digital Garden)
*   **Bilibili**: Siga 潘多拉的数字花园 no Bilibili para vídeos e tutoriais
*   **Multiplataforma**: Também disponível no Weibo, Xiaohongshu (Little Red Book) e Knowledge Planet com o mesmo nome
*   **Contato e feedback**: Sinta-se à vontade para adicionar VX: **PandoraReads**

### ☕ Me pague um café

Se o HiLighter te economiza tempo, você pode convidar o desenvolvedor para um café (escaneando com Alipay / WeChat):

<p align="center">
  <img src="screenshots/buy-me-a-coffee.png" alt="Me pague um café - QR codes Alipay / WeChat" width="640">
</p>

---

## Registro de alterações

### v2.6.0 (2026-10-26)
- **Favoritos e modos de leitura**: a barra do leitor ganha favoritos (marcar a página atual, voltar pela lista, remover com um clique) substituindo o antigo botão de retomada, além de um alternador página ⇄ rolagem — passagem de página horizontal (botões ou deslizar esquerda/direita) ou rolagem vertical contínua, mantendo a posição ao alternar e atualizando o progresso salvo durante a rolagem.
- **Barra do leitor EPUB**: menu suspenso de sumário (pule para qualquer capítulo), salto de página (números de página gerados automaticamente com slider e entrada exata, em cache por livro) e botão «Voltar à última posição de leitura». Saltos por sumário/página/cartão nunca sobrescrevem a posição salva: retomar sempre aponta para onde você realmente parou.
- **Ordem dos cartões**: os cartões de destaque do epub atual agora seguem a ordem de leitura do livro (posição CFI) em vez da ordem de criação; a ordenação por ordem de origem do estúdio usa o mesmo comparador.
- **Leitura e destaques em EPUB (corrigido)**: os arquivos EPUB do vault agora abrem no leitor do HiLighter — antes a visão ficava em branco porque não era registrada como visão de arquivo (FileView) e nunca recebia o arquivo. Selecione texto para destacar em quatro cores, clique em um cartão para voltar à frase exata com um flash de localização, e excluir ou recolorir um cartão reflete instantaneamente na página. Um livro corrompido agora mostra um erro legível com botão de repetir.

### v2.5.1 (2026-10-25)
- **Configuração de modelos de IA**: Os presets agora preenchem o formulário inteiro (resta apenas inserir a chave da API). Um botão "Buscar lista de modelos" puxa os IDs de modelos que sua chave realmente pode usar, e nomes de produtos comuns (ex.: `deepseek-v3`) são autocorrigidos para IDs de modelo reais da API. Em um erro 400/404, a mensagem agora lista os modelos disponíveis para sua chave.
- **Correção do Kimi**: Novas chaves do Kimi só servem modelos `kimi-*` (o preset padrão agora é `kimi-latest`), e o k2.6+ só aceita temperatura 1 — cada modelo agora pode definir sua própria temperatura no editor.
- **Explicação com IA**: A barra de ferramentas de seleção de texto ganha um botão "Explicação com IA" que escreve uma anotação curta direto no campo de nota. O painel de análise de texto completo foi removido.
- **Correções**: O seletor de presets agora rola, e a página de configurações mantém sua posição de rolagem após edições.

### v2.5.0 (2026-10-25)
- **Destaques em PDF**: Selecione texto em qualquer PDF, escolha uma cor, e uma marca translúcida aparece na página enquanto um cartão de nota é criado. As marcas são ancoradas à geometria de seleção relativa à página, então sobrevivem a viradas de página, reaberturas, zoom e sincronizações do vault.
- **Pular para a frase exata**: Clicar em um cartão de PDF rola até a frase destacada e a pisca por ~1,2 s (antes apenas no nível da página).
- **Sincronização bidirecional**: Excluir um cartão remove sua marca no PDF imediatamente; trocar a cor de um cartão atualiza a marca instantaneamente.
- **Correções**: Reparado um bug antigo de falha na captura de destaques em PDF (as âncoras de página nunca eram salvas), um ciclo de repaint da camada de sobreposição e cores de destaque personalizadas que não tingiam as faixas dos cartões da barra lateral.

### v2.4.1 (2026-10-24)
- **Correção do diretório de plugins**: O nome do manifest voltou ao ASCII puro "HiLighter" (o diretório da comunidade rejeita nomes não ASCII e ocultava a entrada). A descrição bilíngue permanece inalterada.

### v2.4.0 (2026-10-24)
- **Mapas mentais (novo)**: Uma entrada "Mapa mental" no estúdio de cartões importa todos os destaques de um arquivo como um mapa mental — agrupados por títulos, cor, tag ou ordem simples — com edição estilo Xmind: arrastar para reorganizar, atalhos Tab/Enter/Delete, recolher/expandir, desfazer/refazer e linhas de associação entre tópicos.
- **Estruturas e temas de mapas mentais**: Layouts lógicos equilibrado/direita/esquerda, além de organograma, linhas do tempo horizontal/vertical, espinha de peixe e catálogo; seis temas de estilo (formas e espessuras de linha, ramificações em arco-íris, formas de nós) e oito paletas de cores (esquemas de fundo/linha/borda com bordas que clareiam por nível, além de uma opção colorida com as cores dos cartões).
- **Integração dos mapas mentais**: Os cartões de destaque permanecem vinculados aos seus nós (edições ressincronizam, cartões excluídos são sinalizados), os nós podem voltar ao texto de origem, e os mapas salvam automaticamente com persistência debounced.
- **Importação/exportação de mapas mentais**: Importar arquivos `.xmind` (formatos moderno e legado, primeira folha); exportar para PNG, `.xmind`, esboço Markdown ou quadro `.canvas` do Obsidian.
- **Notas em Markdown**: Os cartões da galeria e o diálogo de cartão ampliado agora renderizam notas em Markdown (com alternância escrita/pré-visualização no diálogo).
- **Idiomas da interface**: Adicionados japonês, coreano, francês, alemão, espanhol, português e russo (traduções parciais com fallback em inglês), além da opção "Seguir o idioma do Obsidian".
- **Polimento da UI**: Tipografia e alturas unificadas na barra superior do estúdio, ícone de paleta no seletor de tema, barras de rolagem transparentes na barra lateral e no estúdio, e botão de voltar ao topo na lista de destaques da barra lateral.
- **Dados**: Os documentos de mapas mentais são persistidos no IndexedDB (esquema v5, aditivo — sem necessidade de migração).

### v2.3.0 (2026-10-23)
- **Card Studio**: Ordenação pela ordem do texto de origem adicionada como padrão, layout de cartões responsivo, altura de trecho unificada, edição direta no diálogo de cartão ampliado e exportação Markdown de cartões individuais ou grupos completos para uma pasta configurável do vault.
- **Temas e cartões**: Temas e estilos claro/escuro refinados; Ocean, Forest, Galaxy, Sunset e Rose usam pontos de cor em vez de trilhas de cor à esquerda. Removido o rótulo "My Note" dos cartões, com ajustes nos apelidos de cor, posição do pin e do status de revisão.
- **Revisão com flashcards**: Dimensões dos cartões e escala de texto melhoradas, com fluxo de revisão e estados de avaliação mais claros.
- **Notas destacadas**: Adicionado um ponto de entrada de notas na barra de seleção, gatilhos por Cmd/Ctrl-clique e duplo clique, e pré-visualização de notas ao passar o cursor sobre os destaques.
- **Imagens e configurações**: Corrigida a renderização de imagens ao editar notas; suporte a colar/arrastar imagens e pasta de imagens configurável.
- **Ferramentas do estúdio**: Adicionados exportação de grupo e controle de voltar ao topo, e melhorado o comportamento de agrupamento/filtragem do layout.

---

*“Que as notas destacadas sejam o catalisador da inspiração.” — HiLighter*
