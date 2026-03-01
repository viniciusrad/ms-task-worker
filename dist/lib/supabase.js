"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceRoleClient = getServiceRoleClient;
const supabase_js_1 = require("@supabase/supabase-js");
require("dotenv/config");
function getServiceRoleClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Supabase URL ou Service Role Key não configurados no .env do Worker');
    }
    return (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
