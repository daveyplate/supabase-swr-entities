import { useCallback } from "react"
import { useSWRConfig } from "swr"

/**
 * Get the locale value from the internationalized data.
 */
export function getLocaleValue(obj: any, locale: string, defaultLocale?: string | null): string {
    return obj?.[locale] || (defaultLocale ? obj?.[defaultLocale] : obj?.[Object.keys(obj)[0]])
}

export function useClearCache() {
    const { cache } = useSWRConfig()

    const clearCache = useCallback(() => {
        for (let key of cache.keys()) cache.delete(key)
    }, [cache])

    return { clearCache }
}

/**
 * Generate API path from table, id & params.
 */
export function apiPath(table: string | null, id?: string | null, params?: Record<string, string> | null) {
    if (!table) return null

    const route = table.replaceAll('_', '-')
    let path = `/api/${route}`

    if (id) {
        path += `/${id}`
    }

    if (params) {
        const query = new URLSearchParams(params)
        path += `?${query.toString()}`
    }

    return path
}

/**
 * process.env.NEXT_PUBLIC_IS_EXPORT == '1' or 'true' || process.env.NEXT_PUBLIC_IS_MOBILE == '1' or 'true'
 */
export const isExport = () => {
    return process.env.NEXT_PUBLIC_IS_EXPORT == '1'
        || process.env.NEXT_PUBLIC_IS_EXPORT == 'true'
        || process.env.NEXT_PUBLIC_IS_MOBILE == '1'
        || process.env.NEXT_PUBLIC_IS_MOBILE == 'true'

}