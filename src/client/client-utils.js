import { useCallback } from "react"
import { useSWRConfig } from "swr"

/**
 * Get the locale value from the internationalized data.
 * @param {object} obj - The internationalized data.
 * @param {string} locale - The locale.
 * @param {string} defaultLocale - The default locale.
 * @returns {string} The localized value.
 */
export function getLocaleValue(obj, locale, defaultLocale) {
    return obj?.[locale] || obj?.[defaultLocale] || obj?.[Object.keys(obj)[0]]
}

/** 
 * Hook for clearing cache
 * @returns {() => void} Clears the cache
 */
export function useClearCache() {
    const { cache } = useSWRConfig()

    const clearCache = useCallback(() => {
        for (let key of cache.keys()) cache.delete(key)
    }, [cache])

    return clearCache
}

/**
 * Generate API path
 * @param {string} table - The table name
 * @param {string} id - The entity ID
 * @param {object} params - The query parameters
 * @returns {string} The API path
 */
export function apiPath(table, id, params) {
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
 * Check if the app is being exported.
 * @returns {boolean} True if NEXT_PUBLIC_IS_EXPORT is "1" or NEXT_PUBLIC_IS_MOBILE is "true".
 */
export function isExport() {
    return process.env.NEXT_PUBLIC_IS_EXPORT == '1' || process.env.NEXT_PUBLIC_IS_MOBILE == 'true'
}