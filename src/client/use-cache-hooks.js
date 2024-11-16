import { useCallback } from "react"
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"
import useSWR from "swr"
import useSWRInfinite from 'swr/infinite'
import { isExport } from "./client-utils"

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} query - The query to fetch
 * @param {import("swr").SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {import("swr/infinite").SWRInfiniteResponse} The SWR response
 */
export function useInfiniteCache(query, config) {
    const session = useSession()
    const supabase = useSupabaseClient()

    const fetcher = async (url) => {
        const headers = {}
        let basePath = ""

        // Use base URL for export
        if (isExport()) {
            // Pass session access token
            if (session) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }

            if (!url.startsWith("http")) {
                basePath = process.env.NEXT_PUBLIC_BASE_URL
            }
        }

        const res = await fetch(basePath + url, { headers })
        if (res.ok) {
            const json = await res.json()
            return json
            // return { ...json, timestamp: Date.now() }
        } else {
            if (res.status == 401) {
                supabase.auth.signOut()
            }

            if (res.status == 404) {
                return null
            }

            throw new Error(res.statusText)
        }
    }

    const getKey = useCallback((pageIndex, previousPageData) => {
        // reached the end
        if (previousPageData && !previousPageData.data) return null

        // first page, we don't have `previousPageData`
        if (pageIndex === 0) return query

        const { limit } = previousPageData

        // add the cursor to the API endpoint
        return query + `&offset=${pageIndex * limit}`
    }, [query])

    const swr = useSWRInfinite(getKey, { fetcher, ...config })

    return swr
}

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} query - The query to fetch
 * @param {import("swr").SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {import("swr").SWRResponse} The SWR response
 */
export function useCache(query, config) {
    const session = useSession()
    const supabase = useSupabaseClient()

    const fetcher = async (url) => {
        const headers = {}
        let basePath = ""

        // Use base URL for export
        if (isExport()) {
            // Pass session access token
            if (session) {
                headers['Authorization'] = `Bearer ${session.access_token}`;
            }

            if (!url.startsWith("http")) {
                basePath = process.env.NEXT_PUBLIC_BASE_URL
            }
        }

        const res = await fetch(basePath + url, { headers })
        if (res.ok) {
            return res.json()
        } else {
            if (res.status == 401) {
                supabase.auth.signOut()
            }

            if (res.status == 404) {
                return null
            }

            throw new Error(res.statusText)
        }
    }

    return useSWR(query, { fetcher, ...config })
}
