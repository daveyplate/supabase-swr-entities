import { useCallback } from "react"
import { useSWRConfig } from "swr"

/**
 * Get the locale value from the internationalized data.
 */
export function getLocaleValue(obj: Record<string, any>, locale: string, defaultLocale: string): string {
    return obj?.[locale] || obj?.[defaultLocale] || obj?.[Object.keys(obj)[0]]
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
export function apiPath(table: string, id: string, params: Record<string, string>): string | null {
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
 * process.env.NEXT_PUBLIC_IS_EXPORT == '1' || process.env.NEXT_PUBLIC_IS_MOBILE == 'true'
 */
export function isExport() {
    return process.env.NEXT_PUBLIC_IS_EXPORT == '1' || process.env.NEXT_PUBLIC_IS_MOBILE == 'true'
}