import { createClient as createClientPrimitive } from '@supabase/supabase-js'

/**
 * Create a Supabase client with service role key
 * @returns {import("@supabase/supabase-js").SupabaseClient} Supabase service role client
 */
export function createAdminClient() {
    const supabase = createClientPrimitive(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    return supabase
}