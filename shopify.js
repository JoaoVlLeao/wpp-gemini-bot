// shopify.js (ESM)
// Busca pedidos na Shopify por número (#12345), e-mail ou CPF/CNPJ.
// Mantém compatibilidade com summarizeOrder e inclui findOrder.

const STORE_URL = (process.env.SHOPIFY_STORE_URL || '').replace(/\/$/, '');
const API_TOKEN = process.env.SHOPIFY_API_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

if (!STORE_URL || !API_TOKEN) {
  console.error('❌ Shopify não configurado. Verifique SHOPIFY_STORE_URL e SHOPIFY_API_TOKEN no .env');
}

const BASE = `${STORE_URL}/admin/api/${API_VERSION}`;
const HEADERS = {
  'X-Shopify-Access-Token': API_TOKEN,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

// ---------- Utils ----------
function qs(params = {}) {
  const url = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.append(k, String(v));
  });
  return url.toString();
}

async function shopifyGet(path, params = {}) {
  const url = `${BASE}${path}?${qs({ status: 'any', ...params })}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Shopify GET ${path} falhou ${res.status}: ${txt}`);
  }
  return res.json();
}

function onlyDigits(s = '') {
  return (s || '').replace(/\D+/g, '');
}
function isEmail(s = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || '').trim());
}
function isOrderNumber(s = '') {
  return /^\d{3,8}$/.test((s || '').trim());
}
function looksLikeCPF(s = '') {
  return /^\d{11}$/.test(onlyDigits(s));
}
function looksLikeCNPJ(s = '') {
  return /^\d{14}$/.test(onlyDigits(s));
}

// ---------- Tracking extractor ----------
function extractTracking(order) {
  let trackingNumber = null;
  let carrier = null;

  if (Array.isArray(order?.fulfillments) && order.fulfillments.length) {
    const withTracking = [...order.fulfillments]
      .reverse()
      .find(f => (f?.tracking_number || (Array.isArray(f?.tracking_numbers) && f.tracking_numbers.length)));
    if (withTracking) {
      trackingNumber =
        withTracking.tracking_number ||
        (Array.isArray(withTracking.tracking_numbers) ? withTracking.tracking_numbers[0] : null);
      carrier = withTracking.tracking_company || null;
    }
  }

  const trackingUrl = trackingNumber
    ? `https://aquafitbrasil.com/pages/rastreamento?codigo=${trackingNumber}`
    : null;

  return { trackingNumber, trackingUrl, carrier };
}

// ---------- Public: resumo ----------
export function summarizeOrder(order) {
  const { trackingNumber, trackingUrl, carrier } = extractTracking(order);

  let status = 'em processamento';
  if (order.cancelled_at) status = 'cancelado';
  else if (order.fulfillment_status === 'fulfilled') status = 'enviado';
  else if (order.fulfillment_status === 'partial') status = 'parcialmente enviado';
  else if (order.fulfillment_status === 'restocked') status = 'restocado';
  else if (order.fulfillment_status === null && trackingNumber) status = 'enviado';

  const summary = {
    id: order.id,
    name: order.name, // ex: #17333
    email: order.email || order.customer?.email || null,
    phone: order.phone || order.customer?.phone || order.billing_address?.phone || null,
    createdAt: order.created_at,
    financialStatus: order.financial_status,
    fulfillmentStatus: order.fulfillment_status,
    status,
    trackingNumber,
    trackingUrl,
    trackingCarrier: carrier,
  };

  // Log amigável no terminal
  console.log('🧾 Resumo do pedido:', {
    name: summary.name,
    status: summary.status,
    trackingNumber: summary.trackingNumber,
    trackingUrl: summary.trackingUrl,
  });

  return summary;
}

// ---------- Public: por número (#12345) ----------
export async function getOrderByNumber(orderNumber) {
  const name = `#${String(orderNumber).replace(/^#/, '')}`;
  const data = await shopifyGet('/orders.json', { name, limit: 1 });
  const order = data?.orders?.[0] || null;
  if (order) console.log(`✅ Pedido encontrado por número: ${name}`);
  else console.log(`⚠️ Nenhum pedido encontrado por número: ${name}`);
  return order;
}

// ---------- Public: por e-mail (N resultados) ----------
export async function getOrdersByEmail(email, limit = 5) {
  const data = await shopifyGet('/orders.json', { email, limit });
  const orders = data?.orders || [];
  console.log(`🔎 Encontrados ${orders.length} pedidos por e-mail ${email}`);
  return orders;
}

// ---------- Aux: lista recente para varredura (CPF/CNPJ) ----------
async function getRecentOrdersForScan(days = 120, limit = 250) {
  const created_at_min = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const data = await shopifyGet('/orders.json', {
    created_at_min,
    order: 'created_at desc',
    limit,
    fields:
      'id,name,created_at,email,customer,financial_status,fulfillment_status,fulfillments,phone,billing_address,shipping_address,note,note_attributes,tags',
  });
  return data?.orders || [];
}

// ---------- Public: por CPF/CNPJ ----------
export async function getOrderByCPFOrCNPJ(raw) {
  const digits = onlyDigits(raw);
  const isCPF = looksLikeCPF(digits);
  const isCNPJ = looksLikeCNPJ(digits);
  if (!isCPF && !isCNPJ) return null;

  const label = isCPF ? 'CPF' : 'CNPJ';
  const orders = await getRecentOrdersForScan();

  const matchInText = (txt = '') => onlyDigits(txt).includes(digits);

  for (const o of orders) {
    // note_attributes
    if (Array.isArray(o.note_attributes)) {
      for (const na of o.note_attributes) {
        const key = (na?.name || '').toLowerCase();
        const val = String(na?.value || '');
        if (['cpf', 'cnpj', 'documento', 'document', 'tax_id', 'doc', 'cpf/cnpj'].includes(key)) {
          if (matchInText(val)) {
            console.log(`✅ Pedido ${o.name} encontrado por ${label} em note_attributes`);
            return o;
          }
        }
      }
    }

    // tags
    if (Array.isArray(o.tags) && o.tags.length) {
      if (matchInText(o.tags.join(' '))) {
        console.log(`✅ Pedido ${o.name} encontrado por ${label} em tags`);
        return o;
      }
    }

    // endereços
    const addrFields = [
      o.billing_address?.company, o.billing_address?.address1, o.billing_address?.address2,
      o.shipping_address?.company, o.shipping_address?.address1, o.shipping_address?.address2,
      o.billing_address?.name, o.shipping_address?.name,
    ].filter(Boolean).join(' ');
    if (matchInText(addrFields)) {
      console.log(`✅ Pedido ${o.name} encontrado por ${label} em endereço`);
      return o;
    }

    // nota geral
    if (matchInText(o.note)) {
      console.log(`✅ Pedido ${o.name} encontrado por ${label} em note`);
      return o;
    }

    // varredura completa (fallback)
    const blob = JSON.stringify(o);
    if (matchInText(blob)) {
      console.log(`✅ Pedido ${o.name} encontrado por ${label} (varredura geral)`);
      return o;
    }
  }

  console.log(`⚠️ Nenhum pedido encontrado por ${label}: ${digits}`);
  return null;
}

// ---------- Public: busca inteligente unificada ----------
export async function findOrder(query) {
  if (!query) return null;
  const raw = String(query).trim();

  try {
    // 1) e-mail
    if (isEmail(raw)) {
      const orders = await getOrdersByEmail(raw, 5);
      return orders?.[0] || null;
    }

    // 2) número do pedido (#12345)
    const num = raw.replace(/^#/, '');
    if (isOrderNumber(num)) {
      return await getOrderByNumber(num);
    }

    // 3) CPF/CNPJ (11 ou 14 dígitos)
    const digits = onlyDigits(raw);
    if (looksLikeCPF(digits) || looksLikeCNPJ(digits)) {
      return await getOrderByCPFOrCNPJ(digits);
    }

    console.log('ℹ️ findOrder: termo não reconhecido como e-mail, número ou CPF/CNPJ:', raw);
    return null;
  } catch (err) {
    console.error('❌ Erro em findOrder:', err);
    return null;
  }
}
