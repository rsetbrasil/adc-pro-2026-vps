import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import type { AsaasSettings } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Cria cliente Supabase para uso server-side
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const webhookSchema = z.object({
  event: z.string().min(1),
  payment: z
    .object({
      id: z.string().min(1),
      status: z.string().optional(),
      externalReference: z.string().optional(),
      value: z.number().optional(),
      netValue: z.number().optional(),
      paymentDate: z.string().optional(),
      confirmedDate: z.string().optional(),
    })
    .passthrough(),
}).passthrough();

function isPaidStatus(status?: string | null) {
  const s = (status || '').toUpperCase();
  return s === 'RECEIVED' || s === 'CONFIRMED';
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido.' }, { status: 400 });
  }

  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const { event, payment } = parsed.data;
  const paymentId = payment.id;
  const externalReference = (payment.externalReference || '').trim();

  try {
    // Buscar token do webhook nas configurações
    let expectedToken = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
    if (!expectedToken) {
      const { data: settingsData } = await supabase
        .from('config')
        .select('value')
        .eq('key', 'asaasSettings')
        .maybeSingle();

      if (settingsData?.value) {
        const settings = settingsData.value as AsaasSettings;
        expectedToken = (settings.webhookToken || '').trim();
      }
    }

    const providedToken = (request.headers.get('asaas-access-token') || '').trim();
    if (!expectedToken || !providedToken || providedToken !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let orderId = externalReference;
    if (!orderId) {
      // Buscar mapeamento de pagamento
      const { data: mapData } = await supabase
        .from('asaas_payment_map')
        .select('orderId')
        .eq('paymentId', paymentId)
        .maybeSingle();

      if (mapData) {
        orderId = String(mapData.orderId || '');
      }
    }

    if (!orderId) {
      return NextResponse.json({ ok: true });
    }

    // Buscar pedido existente
    const { data: orderData } = await supabase
      .from('orders')
      .select('asaas')
      .eq('id', orderId)
      .maybeSingle();

    if (!orderData) {
      return NextResponse.json({ ok: true });
    }

    const status = payment.status || null;
    const nowIso = new Date().toISOString();
    const existingAsaas = orderData.asaas || {};

    const patchAsaas = {
      ...existingAsaas,
      paymentId,
      status,
      lastEvent: event,
      updatedAt: nowIso,
      paidAt: isPaidStatus(status) ? (payment.paymentDate || payment.confirmedDate || nowIso) : (existingAsaas.paidAt || null),
    };

    // Atualizar pedido
    await supabase
      .from('orders')
      .update({ asaas: patchAsaas })
      .eq('id', orderId);

    // Atualizar tabela de pagamentos Asaas (se existir)
    await supabase
      .from('asaas_payments')
      .upsert({
        orderId,
        status,
        lastEvent: event,
        updatedAt: nowIso,
      }, { onConflict: 'orderId' });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Webhook error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro inesperado.' }, { status: 500 });
  }
}
