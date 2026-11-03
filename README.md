# Lumys

A aplicação permite criar questionários, responder a formulários e consultar
resultados em gráficos por dia e por pergunta, além de ver as respostas
individuais. Os resultados numéricos podem ser visualizados em gráficos de
barras, linhas ou rosca, e as respostas podem ser exportadas em CSV. Os
rascunhos e uma cópia local dos formulários e respostas são
armazenados no navegador com IndexedDB. Publique um formulário no editor para
gerar um código, link e QR code públicos; as respostas recebidas pela página
pública são salvas no PostgreSQL e sincronizadas no painel de resultados do
proprietário. A busca por código e o leitor de QR estão disponíveis na página
inicial. O leitor de QR requer permissão de câmera e, em produção, HTTPS.
Os links dos formulários permanecem no escopo do aplicativo; o manifesto pede
ao navegador que encaminhe links compatíveis para a PWA instalada. A captura
automática de links externos depende do suporte do navegador e do sistema.

Formulários e respostas podem ser criados e consultados offline neste dispositivo.
Formulários públicos só podem ser abertos offline depois de terem sido carregados
nele ao menos uma vez. Alterações e respostas ficam em uma fila persistente no
IndexedDB e são reenviadas quando a conexão volta e o aplicativo está aberto; as
operações da conta aguardam o login da mesma conta. Primeiro login e primeiro
acesso a um formulário remoto dependem de conexão; um formulário preparado para
publicação offline só fica acessível por link depois que o servidor receber a
fila. Sair offline encerra o acesso local imediatamente e o encerramento da
sessão no servidor é tentado novamente quando a conexão retorna.

É necessário criar uma conta ou entrar para acessar o espaço de trabalho. Os
formulários locais existentes são associados à primeira conta usada nesse
navegador; após o login, formulários e respostas são sincronizados para que
possam ser acessados em outros dispositivos. As pessoas que respondem por
código/link/QR não precisam de conta. O painel separa os questionários da
conta dos questionários respondidos; respostas enviadas com login são
associadas à conta e aparecem em outros dispositivos. Sem login, o histórico de
questionários respondidos fica salvo somente no navegador usado para responder.

O cadastro exige uma senha com pelo menos 6 caracteres. As senhas são
armazenadas como hash bcrypt; sessões usam cookies HttpOnly e expiram após
30 dias. A câmera do leitor QR requer permissão e, em produção, HTTPS.

## Criar formulários via JSON

Durante a edição, use **Importar JSON** para substituir título, descrição e
perguntas do formulário atual. Também é possível enviar o objeto diretamente
dentro de uma propriedade `formulario`. Tipos aceitos: `curta`, `paragrafo`, `multipla`,
`caixas`, `lista`, `escala` e `data`. Perguntas de escolha precisam de pelo
menos duas opções. A pergunta `escala` usa um controle deslizante com padrão de
1 a 5; seus limites podem ser configurados entre 0 e 100. Ao importar para um
formulário existente, as respostas anteriores são mantidas, mas podem não
corresponder às perguntas novas.

```json
{
  "titulo": "Exemplo com todos os tipos de pergunta",
  "descricao": "Edite este JSON e importe o questionário.",
  "perguntas": [
    {
      "titulo": "Qual é o seu nome?",
      "tipo": "curta",
      "obrigatoria": true
    },
    {
      "titulo": "Conte um pouco sobre você.",
      "tipo": "paragrafo",
      "obrigatoria": false
    },
    {
      "titulo": "Qual meio de contato prefere?",
      "tipo": "multipla",
      "obrigatoria": true,
      "opcoes": ["E-mail", "Telefone", "WhatsApp"]
    },
    {
      "titulo": "Quais assuntos interessam a você?",
      "tipo": "caixas",
      "obrigatoria": false,
      "opcoes": ["Novidades", "Ofertas", "Eventos"]
    },
    {
      "titulo": "Qual sua região?",
      "tipo": "lista",
      "obrigatoria": false,
      "opcoes": ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"]
    },
    {
      "titulo": "Como avalia sua experiência?",
      "tipo": "escala",
      "obrigatoria": true,
      "escalaMin": 1,
      "escalaMax": 5
    },
    {
      "titulo": "Qual a melhor data para contato?",
      "tipo": "data",
      "obrigatoria": false
    }
  ]
}
```

## Desenvolvimento local

Instale as dependências na raiz:

```sh
npm install
```

Inicie o frontend e a API:

```sh
npm run dev
```

A API usa `server/.env` para carregar `DATABASE_URL` e `PORT` (por padrão,
`3001`). O Vite encaminha as rotas `/sync` e `/api` para essa API durante o
desenvolvimento. A API cria as tabelas de contas, sessões, formulários e
respostas no PostgreSQL ao iniciar. Para iniciar somente a API, use
`npm run dev:server`.

## Produção

Configure `DATABASE_URL` e, se necessário, `PORT` no ambiente de hospedagem.
Execute `npm run build` para gerar o frontend em `dist/` e `npm start` para
servir o frontend e as APIs no mesmo host. Não configure `VITE_API_URL` quando
frontend e API compartilham o mesmo domínio.

### Vercel

Importe o repositório com a raiz do projeto como **Root Directory**. Use
`npm run build` como comando de build e `dist` como diretório de saída. A
Vercel hospeda o frontend como arquivos estáticos e executa a API Express em
`api/index.js`; as rotas `/api/*` e `/sync/*` são encaminhadas para essa função,
e o fallback SPA mantém os links internos funcionando.

Adicione `DATABASE_URL` nas variáveis de ambiente da Vercel para Production e
Preview. Use a URL de conexão de um PostgreSQL acessível pela internet (de
preferência a URL com pooler oferecida pelo provedor). O schema é criado na
primeira requisição à API de cada instância. Não configure `PORT` nem
`VITE_API_URL` na Vercel. Depois de publicar, confira a página inicial e
experimente criar uma conta; uma resposta `401` em `/api/auth/sessao` sem
sessão é esperada.
