import { AuthError, PostgrestError, SupabaseClient, User } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/service-role'
import { IncomingHttpHeaders } from 'http'
import { HTTP_METHOD } from 'next/dist/server/web/http'

export const METHOD_MAP: Record<HTTP_METHOD, string> = {
    GET: "select",
    PATCH: "update",
    POST: "upsert",
    DELETE: "delete",
    HEAD: '',
    OPTIONS: '',
    PUT: 'update'
}

export async function authorizeUser(
    supabase: SupabaseClient,
    headers: IncomingHttpHeaders
): Promise<{
    user?: User | Record<string, any>,
    error?: PostgrestError | AuthError
}> {
    const supabaseAdmin = createAdminClient()

    // Check for Bearer access token
    const authToken = headers?.authorization?.split('Bearer ')[1]

    // Check api_keys for a user entry
    if (authToken?.startsWith('sk-')) {
        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .select('user_id')
            .eq('api_key', authToken)
            .single()

        if (error) {
            console.error(error)
            return { error }
        }

        return { user: { id: data!.user_id } }
    }

    const { data: { user }, error } = await supabase.auth.getUser()

    if (error) {
        console.error(error)
        return { error }
    }

    return { user: user! }
}

export async function authorizeParams(
    supabase: SupabaseClient,
    method: HTTP_METHOD,
    headers: IncomingHttpHeaders,
    params: Record<string, any>,
    entitySchema: Record<string, any>,
    admin = false
): Promise<{
    user?: User | Record<string, any>,
    error?: PostgrestError | AuthError | Error
}> {
    const { user, error } = await authorizeUser(supabase, headers)
    if (error || !user) return { error }

    // TODO setup admin claim
    if (admin && !user.app_metadata?.roles?.includes('admin')) {
        return { error: new Error("Unauthorized") }
    }

    // Add authColumns to params if not admin
    if (!admin) {
        const authColumns = entitySchema.authColumns?.[METHOD_MAP[method]] || [entitySchema.authColumn]
        if (!authColumns.length) return { error: new Error("No authColumns found") }

        if (authColumns.length == 1) {
            params[authColumns[0]] = user.id
        } else {
            params.or = authColumns.map((column: string) => column + ".eq." + user.id).join(',')
        }
    }

    return { user }
}