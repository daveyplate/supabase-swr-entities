import { useCallback } from "react"
import useSWR, { SWRConfiguration, SWRResponse } from "swr"
import useSWRInfinite, { SWRInfiniteResponse } from 'swr/infinite'
import { SupabaseClient, Session } from "@supabase/supabase-js"
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"

import { isExport } from "./client-utils"

/**
 * Custom fetcher for SWR
 * @param {SupabaseClient} supabase - The Supabase client
 * @param {Session} session - The Supabase session
 * @param {string} url - The URL to fetch
 * @returns {Promise<any>} The fetch response
 * @throws {Error} The fetch error
 */
const fetcher = async (supabase, session, url) => {
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

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} query - The query to fetch
 * @param {SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {SWRInfiniteResponse} The SWR response
 */
export function useInfiniteCache(query, config) {
    const session = useSession()
    const supabase = useSupabaseClient()

    const getKey = useCallback((pageIndex, previousPageData) => {
        // reached the end
        if (previousPageData && !previousPageData.data) return null

        // first page, we don't have `previousPageData`
        if (pageIndex === 0) return query

        const { limit } = previousPageData

        // add the cursor to the API endpoint
        return query + `&offset=${pageIndex * limit}`
    }, [query])

    const swr = useSWRInfinite(getKey, {
        fetcher: (url) => fetcher(supabase, session, url),
        ...config
    })

    return swr
}

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} query - The query to fetch
 * @param {SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {SWRResponse} The SWR response
 */
export function useCache(query, config) {
    const session = useSession()
    const supabase = useSupabaseClient()

    return useSWR(query, {
        fetcher: (url) => fetcher(supabase, session, url)
        , ...config
    })
}
