import { useCallback } from "react"
import useSWR, { SWRConfiguration, SWRResponse } from "swr"
import useSWRInfinite, { SWRInfiniteResponse } from 'swr/infinite'
import { SupabaseClient, Session } from "@supabase/supabase-js"
import { useSession, useSessionContext, useSupabaseClient } from "@supabase/auth-helpers-react"

import { isExport } from "./client-utils"

/**
 * Custom fetcher for SWR
 * @param {string} url - The URL to fetch
 * @param {string} [token] - The access token
 * @returns {Promise<any>} The fetch response
 * @throws {Error} The fetch error
 */
const fetcher = async (url, token) => {
    const headers = {}
    let basePath = ""

    // Use base URL for export
    if (isExport()) {
        // Pass session access token
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
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
            // supabase.auth.signOut()
        }

        if (res.status == 404) {
            // return null
        }

        throw new Error(res.statusText)
    }
}

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} url - The query to fetch
 * @param {SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {SWRInfiniteResponse} The SWR response
 */
export function useInfiniteCache(url, config) {
    const { session, isLoading: sessionLoading } = useSessionContext()

    const getKey = useCallback((pageIndex, previousPageData) => {
        // reached the end
        if (previousPageData && !previousPageData.data) return null

        // first page, we don't have `previousPageData`
        if (pageIndex === 0) return [url, session?.access_token]

        const { limit } = previousPageData

        // add the cursor to the API endpoint
        return [url + `&offset=${pageIndex * limit}`, session?.access_token]
    }, [url, session])

    const swr = useSWRInfinite(!sessionLoading && url && getKey, {
        fetcher: ([url, token]) => fetcher(url, token),
        ...config
    })

    return { ...swr, isLoading: sessionLoading || swr.isLoading }
}

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} url - The query to fetch
 * @param {SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {SWRResponse} The SWR response
 */
export function useCache(url, config) {
    const { session, isLoading: sessionLoading } = useSessionContext()

    const swr = useSWR(!sessionLoading && url && [url, session?.access_token], {
        fetcher: ([url, token]) => fetcher(url, token)
        , ...config
    })

    return { ...swr, isLoading: sessionLoading || swr.isLoading }
}
