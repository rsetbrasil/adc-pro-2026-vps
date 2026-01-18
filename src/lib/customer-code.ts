import { supabase } from './supabase';

export function formatCustomerCode(value: number): string {
  return String(value).padStart(5, '0');
}

export async function allocateNextCustomerCode(): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'customerCodeCounter')
      .maybeSingle();

    if (error) throw error;

    const lastNumber = data?.value?.lastNumber || 0;
    const nextNumber = lastNumber + 1;

    const { error: updateError } = await supabase
      .from('config')
      .upsert({
        key: 'customerCodeCounter',
        value: { lastNumber: nextNumber }
      });

    if (updateError) throw updateError;

    return formatCustomerCode(nextNumber);
  } catch (error) {
    console.error("Error allocating customer code in Supabase:", error);
    // Fallback: use timestamp if everything fails
    return formatCustomerCode(Math.floor(Date.now() / 1000) % 100000);
  }
}

export async function reserveCustomerCodes(
  count: number,
  minLastNumber: number = 0
): Promise<{ startNumber: number; endNumber: number }> {
  if (count <= 0) {
    return { startNumber: 0, endNumber: 0 };
  }

  try {
    const { data, error } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'customerCodeCounter')
      .maybeSingle();

    if (error) throw error;

    const lastNumberRaw = data?.value?.lastNumber || 0;
    const lastNumber = Number.isFinite(lastNumberRaw) ? lastNumberRaw : 0;
    const base = Math.max(lastNumber, minLastNumber);
    const startNumber = base + 1;
    const endNumber = base + count;

    await supabase
      .from('config')
      .upsert({
        key: 'customerCodeCounter',
        value: { lastNumber: endNumber }
      });

    return { startNumber, endNumber };
  } catch (error) {
    console.error("Error reserving customer codes in Supabase:", error);
    return { startNumber: 0, endNumber: 0 };
  }
}

