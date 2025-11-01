// index.js
import 'dotenv/config';
import fs from "fs";
import path from "path";
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { getOrderByNumber, summarizeOrder } from './shopify.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import express from "express"; // <-- adicione esta importação aqui

// ====== KEEP ALIVE SERVER ======
const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.send("💓 KeepAlive: bot rodando normalmente"));
app.listen(PORT, () => console.log(`🌐 Servidor ativo na porta ${PORT}`));

const log = pino({ level: 'info' });

// ======= Gemini setup =======
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

// ======= Sessões =======
const sessions = new Map();
const MAX_TURNS = 12;

function getSession(chatId) {
  if (!sessions.has(chatId))
sessions.set(chatId, {
  history: [],
  name: null,
  greeted: false,
  batch: [],
  timer: null,
  buffer: [],
  bufferTimer: null
});

  return sessions.get(chatId);
}

function pushHistory(session, role, text) {
  session.history.push({ role, text });
  if (session.history.length > MAX_TURNS * 2)
    session.history = session.history.slice(-MAX_TURNS * 2);
}

// ======= Função principal (Gemini) =======
async function chatWithGemini(session, userMessage, contextData = null, isFirstMessage = false) {
  try {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    let contextText = `
Você é *Fernanda*, atendente da loja *AquaFit Brasil*.
Seu tom é natural, gentil e humano — como uma conversa real no WhatsApp.
Use frases curtas, claras e educadas.  
Responda sempre em português.  
Use o nome da cliente (${session.name || 'não informado'}) apenas quando for natural.  
Jamais repita apresentações após a primeira mensagem.
`;

    if (isFirstMessage && !session.greeted) {
      contextText += `
Na primeira mensagem, apresente-se de forma breve:  
"Oi, ${session.name || ''}? Aqui é a Fernanda, da AquaFit Brasil. Como posso te ajudar hoje?"  
Essa apresentação ocorre apenas na primeira mensagem.
`;
    }

    contextText += `
⚙️ INSTRUÇÕES DE ATENDIMENTO:caso a cliente não tenha fornecido no número do pedido nas primeiras mensagens, pergunte primeiro qual o número do pedido.
1. Existem dois tipos de atendimento: *Tira Dúvidas* e *Problemas*.
   - Ao identificar um problema, use o tom mais empático possível.
   - Baseie-se apenas nas informações fornecidas abaixo, sem inventar nada.
   - Se não souber a resposta, diga que não possui essa informação.
   - Se for fora da loja AquaFit, diga educadamente que só pode responder sobre a loja AquaFit Brasil.

2. Para *Tira Dúvidas*:
   - Nunca mencione envio internacional.
   - Nunca fale em dias úteis.
   - Diga que o prazo médio de entrega é de 7 a 14 dias.
   - O código de rastreamento é enviado em até 24h após a compra.
   - As entregas são feitas pelos Correios.

3. Se a cliente disser que está informando o *número do pedido* ou você pedir o número,
   e ela enviar um número com MAIS DE 5 DÍGITOS, 
   *não tente consultar o sistema*.
   Em vez disso, diga de forma gentil e empática que provavelmente há um engano,
   e que o número do pedido é de 5 dígitos, enviado por WhatsApp e e-mail logo após a compra. Como por exemplo: #17545.


4. Casos específicos:
   - *Taxado:* dizer que as taxas já foram pagas pela AquaFit.
   - *Importação não autorizada:* informar que um novo produto foi reenviado no mesmo dia.
   - *Troca ou devolução:* pedir para enviar e-mail para suporte@aquafitbrasil.com. Em casos de atrasos, depois de enviar o rastreamento para a cliente, falar que é por conta do atraso da logística dos correios e se desculpar. Além disso, da primeira vez que a cliente falar sobre atraso, fale que verificou no nosso sistema o rastreamento e que ela deve receber em 7 dias. Nas próximas vezes que a cliente falar sobre o atraso, não necessariamente precisa ficar repetindo essa informação.
   - *Cancelamento:* tentar contornar, mas se insistir, orientar a enviar e-mail com assunto "Cancelamento - Número do pedido".

Política geral da loja:
Prazo médio de entrega: 7 a 14 dias.
Código de rastreamento: enviado em até 24h.
Envio realizado pelos Correios.
Trocas e devoluções: processadas em até 30 dias após o recebimento.
Estorno: feito pela mesma forma de pagamento, nunca via Pix direto.
Questões comuns: 1) Quanto tempo demora a entrega? — Prazo médio de 7 a 14 dias, frete grátis, rastreamento em 24h. 2) Tamanho certo — use a tabela e peso como referência; acima de 90kg, indicar GG. Troca é fácil se não servir. 3) Conforto — tecidos de alta elasticidade, bojo removível, tiras ajustáveis e resistência ao cloro, sal e sol. 4) E se não gostar? — pode trocar ou devolver em até 7 dias. 5) As fotos são fiéis? — sim, feitas com luz natural, pequenas variações de tom são normais. 6) Vale a pena pelo preço? — sim, peças de qualidade premium e alta durabilidade.
`;

    if (contextData) {
      const rastreioLink = contextData.trackingNumber
        ? `https://aquafitbrasil.com/pages/rastreamento?codigo=${contextData.trackingNumber}`
        : null;
      contextText += `
📦 Pedido:
- Número: ${contextData.name || 'não informado'}  
- Status: ${contextData.status || 'não informado'}  
- Rastreamento: ${contextData.trackingNumber || 'não disponível'}  
${rastreioLink ? `- Link: ${rastreioLink}` : ''}

Diga algo como:
"O número de rastreamento é *${contextData.trackingNumber || ''}*.  
Você pode acompanhá-lo no link abaixo:"  
E então envie o link completo.  
`;
    }

    const historyText = session.history
      .map(h => `${h.role === 'user' ? 'Cliente' : 'Fernanda'}: ${h.text}`)
      .join('\n');

    const prompt = `
${contextText}
Histórico:
${historyText}

Nova mensagem:
"${userMessage}"

Responda como *Fernanda*, de forma empática e natural, no máximo duas mensagens curtas.Foque apenas na última mensagem recebida.
Use o histórico apenas como contexto leve, não repita informações antigas, a menos que seja necessário.
Se a cliente mudar de assunto, responda ao novo tema e ignore mensagens anteriores que não sejam mais relevantes.
Responda de forma natural, empática e breve (máximo de duas mensagens curtas).
Evite repetir informações já confirmadas anteriormente, a menos que a cliente peça novamente.
Não mencione atrasos, prazos ou rastreios se a nova pergunta não for sobre isso.
`;

    const result = await model.generateContent([prompt]);
    const text = result.response.text()?.trim();
    if (!text) return ['Desculpe, não consegui entender direito.'];

    if (text.length > 300)
      return text.match(/.{1,300}(\s|$)/g).map(p => p.trim());

    return [text];
  } catch (err) {
    console.error('Erro no chatWithGemini:', err);
    return ['Desculpe, houve um problema. Pode tentar novamente em instantes?'];
  }
}

// ======= WhatsApp setup =======
import puppeteer from "puppeteer";

const client = new Client({
  authStrategy: new LocalAuth(), // mantém sessão salva no container
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-features=site-per-process',
      '--use-gl=egl'
    ],
    executablePath: puppeteer.executablePath()

  }
});



client.on('qr', qr => {
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  log.info(`📱 Escaneie o QR code nesse link: ${qrImageUrl}`);
});

client.on('ready', () => log.info('✅ WhatsApp conectado e pronto.'));
client.on('auth_failure', m => log.error({ m }, 'Falha de autenticação'));
client.on('disconnected', r => log.warn({ r }, 'Desconectado'));

// ======= HANDLER =======
client.on('message', async message => {
  try {
    const chat = await message.getChat();
    const contact = await message.getContact();
// 🟡 Se for áudio ou imagem, processa com Gemini
if (message.type === 'audio' || message.type === 'ptt' || message.type === 'image') {
  const media = await message.downloadMedia();
  if (!media || !media.data) return;

  import fs from "fs";
  import path from "path";

  // Define extensão conforme o tipo
  const ext = message.type === 'image' ? 'jpg' : 'ogg';
  const filePath = path.resolve(`./temp_${message.id.id}.${ext}`);
  fs.writeFileSync(filePath, media.data, 'base64');

  console.log(`🟢 Mídia recebida (${message.type}) de ${contact.pushname}`);

  // Seleciona o modelo multimodal do Gemini
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

  let prompt;
  let content;

  if (message.type === 'audio' || message.type === 'ptt') {
    // Áudio → transcrição
    content = {
      inlineData: {
        mimeType: "audio/ogg",
        data: media.data
      }
    };
    prompt = "Transcreva este áudio com clareza, pontuação e naturalidade, retornando apenas o texto falado:";
  } else {
    // Imagem → interpretação
    content = {
      inlineData: {
        mimeType: "image/jpeg",
        data: media.data
      }
    };
    prompt = `
Você é Fernanda, atendente da AquaFit Brasil.
Descreva de forma breve e educada o que aparece nesta imagem.
Se for uma foto de produto, tente identificar se parece com um item da loja.
Não invente informações. Responda com uma frase natural.`;
  }

  const result = await model.generateContent([prompt, content]);
  const interpretation = result.response.text().trim();

  console.log(`📝 Interpretação da mídia: ${interpretation}`);

  // substitui o conteúdo da mensagem pelo texto interpretado
  message.body = interpretation;

  // e marca o tipo como texto, para o restante do código seguir normalmente
  message.type = 'chat';
}


    const text = message.body?.trim();
    if (!text) return;
// ====== BUFFER DE MENSAGENS ======
const session = getSession(message.from);
if (!session.name && contact.pushname)
  session.name = contact.pushname.split(' ')[0];

// se ainda não existe buffer para este chat, cria
if (!session.buffer) session.buffer = [];
session.buffer.push(text);

// se já houver um timer, cancela
if (session.bufferTimer) clearTimeout(session.bufferTimer);

// se for a primeira mensagem da conversa, espera 25 segundos; senão, 10 segundos
const delay = !session.greeted ? 25000 : 10000;

session.bufferTimer = setTimeout(async () => {
  const combinedText = session.buffer.join('\n');
  session.buffer = [];
  session.bufferTimer = null;

  pushHistory(session, 'user', combinedText);
  session.lastActive = Date.now();

  // Delay natural antes de começar a digitar (após o primeiro contato)
  if (session.greeted) {
    await new Promise(r => setTimeout(r, 1500));
    chat.sendStateTyping();
    await new Promise(r => setTimeout(r, 1500));
  } else {
    chat.sendStateTyping();
  }

  let orderData = session.orderData || null; // tenta recuperar o pedido salvo da sessão
const matchOrder = combinedText.match(/\b(\d{3,8})\b/);
const matchEmail = combinedText.match(/[^\s]+@[^\s]+/);
const matchCPF = combinedText.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);

if (matchOrder || matchEmail || matchCPF) {
  try {
    const key = matchOrder ? matchOrder[1] : matchEmail ? matchEmail[0] : matchCPF[0];
    const order = await getOrderByNumber(key);
    if (order) {
      orderData = summarizeOrder(order);
      session.orderData = orderData; // 🔥 salva permanentemente na memória da conversa
      console.log('📦 Pedido encontrado (novo ou atualizado):');
      console.log(JSON.stringify(orderData, null, 2));
    }
  } catch (err) {
    console.error('Erro ao buscar pedido:', err);
  }
}

  const replies = await chatWithGemini(session, combinedText, orderData, !session.greeted);
  for (const part of replies) {
    await message.reply(part);
    await new Promise(r => setTimeout(r, 1000));
  }

  session.greeted = true;
  chat.clearState();
}, delay); // espera 25s na 1ª mensagem, 10s nas demais


return;

    const isFirstMessage = !session.greeted;

    // ====== AGRUPA MENSAGENS INICIAIS ======
    if (isFirstMessage) {
      session.batch.push(text);
      if (session.timer) clearTimeout(session.timer);

      const delay = session.batch.length === 1 ? 25000 : 10000;
      session.timer = setTimeout(async () => {
        const combined = session.batch.join('\n');
        pushHistory(session, 'user', combined);
        chat.sendStateTyping();

        // 🔎 Busca pedidos se houver número, e-mail ou CPF
        let orderData = null;
        const matchOrder = combined.match(/\b(\d{3,8})\b/);
        const matchEmail = combined.match(/[^\s]+@[^\s]+/);
        const matchCPF = combined.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);

        if (matchOrder || matchEmail || matchCPF) {
          try {
            const key = matchOrder ? matchOrder[1] : matchEmail ? matchEmail[0] : matchCPF[0];
            const order = await getOrderByNumber(key);
            if (order) {
              orderData = summarizeOrder(order);
              console.log('📦 Pedido encontrado (mensagem inicial):');
              console.log(JSON.stringify(orderData, null, 2));
            }
          } catch (err) {
            console.error('Erro ao buscar pedido na mensagem inicial:', err);
          }
        }

        const replies = await chatWithGemini(session, combined, orderData, true);
        for (const part of replies) {
          await message.reply(part);
          await new Promise(r => setTimeout(r, 1000));
        }

        session.greeted = true;
        session.batch = [];
        session.timer = null;
        chat.clearState();
      }, delay);

      return;
    }

     } catch (err) {
    console.error('Erro no handler principal:', err);
    try {
      await message.reply('Desculpe, ocorreu um erro inesperado.');
    } catch {}
  }
});
process.on('uncaughtException', err => {
  console.error('❌ Erro não tratado:', err);
});
process.on('unhandledRejection', err => {
  console.error('❌ Promessa rejeitada:', err);
});

// Impede o Railway de reiniciar constantemente
setInterval(() => {
  console.log('💓 KeepAlive: bot rodando normalmente');
}, 60 * 1000); // 1 minuto

client.initialize().catch(e => console.error('Erro ao iniciar o WhatsApp client', e));

// ======= LIMPEZA AUTOMÁTICA DE SESSÕES =======

// Marca o horário da última atividade do usuário (adicione session.lastActive = Date.now() dentro do handler!)
setInterval(() => {
  const now = Date.now();

  for (const [chatId, session] of sessions) {
    if (!session.lastActive) continue; // ignora se ainda não foi usado

    const diffMins = (now - session.lastActive) / 1000 / 60;

    if (diffMins > 25) { // 25 minutos sem interação
      console.log(`🧹 Limpando sessão inativa de ${chatId} (${diffMins.toFixed(1)}min sem atividade)`);
      sessions.delete(chatId);
    }
  }
}, 10 * 60 * 1000); // verifica a cada 10 minutos
