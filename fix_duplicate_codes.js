
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function formatCustomerCode(number) {
    return number.toString().padStart(5, '0');
}

async function fixDuplicates() {
    console.log('Fetching customers...');

    // 1. Fetch all customers
    const { data: customers, error } = await supabase
        .from('customers')
        .select('id, name, code, created_at');

    if (error) {
        console.error('Error fetching customers:', error);
        return;
    }

    if (!customers || customers.length === 0) {
        console.log('No customers found.');
        return;
    }

    // 2. Find max code to know where to start new codes
    let maxCode = 0;
    customers.forEach(c => {
        const codeNum = parseInt(c.code, 10);
        if (!isNaN(codeNum) && codeNum > maxCode) {
            maxCode = codeNum;
        }
    });

    console.log(`Current Max Code is: ${maxCode}`);
    let nextCode = maxCode + 1;

    // 3. Identify Duplicates
    const codeMap = new Map();
    const toUpdate = [];

    // Sort by created_at to keep the oldest one and update the newer ones
    // If created_at is null/same, fallback to ID sorting logic or generic sort
    customers.sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateA - dateB;
    });

    customers.forEach(customer => {
        const code = customer.code;
        if (code) {
            if (codeMap.has(code)) {
                // Duplicate found! This 'customer' is newer than the one in the map
                const newCode = formatCustomerCode(nextCode);
                console.log(`Duplicate found for code ${code}. Renaming customer "${customer.name}" (${customer.id}) to new code ${newCode}`);

                toUpdate.push({
                    id: customer.id,
                    code: newCode
                });

                nextCode++;
            } else {
                codeMap.set(code, customer);
            }
        }
    });

    if (toUpdate.length === 0) {
        console.log('No duplicates to fix.');
        return;
    }

    console.log(`Fixing ${toUpdate.length} duplicates...`);

    // 4. Update in batches
    for (const update of toUpdate) {
        const { error: updateError } = await supabase
            .from('customers')
            .update({ code: update.code })
            .eq('id', update.id);

        if (updateError) {
            console.error(`Failed to update customer ${update.id}:`, updateError);
        } else {
            console.log(`Updated customer ${update.id} to code ${update.code}`);
        }
    }

    console.log('Done!');
}

fixDuplicates();
