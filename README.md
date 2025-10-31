# WPP + Gemini Bot (Passo a passo BÁSICO)

## 0) Você precisa
- Node.js 18 ou 20 instalado.
- Uma chave da API do Gemini (Google AI Studio).
- Um número de WhatsApp só para o bot.

## 1) Instalar dependências
No terminal, dentro da pasta do projeto:
```
npm install
```

## 2) Configurar o .env
- Duplique o arquivo `.env.example` e renomeie para `.env`.
- Abra o `.env` e coloque sua chave em `GEMINI_API_KEY=`.

## 3) Rodar localmente (primeira vez)
```
npm start
```
Vai aparecer um QR no terminal. No seu WhatsApp:
- Abra **Aparelhos conectados** > **Conectar um aparelho** > aponte para o QR do terminal.

Envie uma mensagem para o número do bot. Ele já responde.

## 4) Deixar 24h no servidor (opcional)
Em uma VPS (Ubuntu), instale o Node e o PM2, suba o projeto e rode:
```
sudo npm i -g pm2
pm2 start index.js --name wpp-gemini-bot
pm2 logs wpp-gemini-bot
pm2 save
pm2 startup
```
Na primeira execução, pare o PM2 e rode `node index.js` para ver o QR no terminal e logar uma vez.

## 5) Comandos úteis no WhatsApp
- `/reset` — limpa o contexto daquela conversa.
- `/help` — mostra ajuda.
- Em grupos, o bot só responde se você mencionar o nome do bot (por exemplo "SanusBot, ...").

## 6) Dúvidas comuns
- Sem resposta? Confira o `.env` (chave correta) e se não excedeu limites do Gemini.
- Deslogou? Rode `node index.js` e reconecte o QR. Depois volte ao PM2.
- Atualizações do WhatsApp podem exigir atualizar a lib `whatsapp-web.js`.
