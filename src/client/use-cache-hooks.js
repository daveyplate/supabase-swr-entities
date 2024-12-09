import { useCallback } from "react"
import useSWR from "swr"
import useSWRInfinite from 'swr/infinite'
import { useAPI } from "./api-methods.js"

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} url - The query to fetch
 * @param {import("swr").SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {import("swr/infinite").SWRInfiniteResponse} The SWR response
 */
export function useInfiniteCache(url, config) {
    const { getAPI } = useAPI()

    const getKey = useCallback((pageIndex, previousPageData) => {
        // reached the end
        if (previousPageData && !previousPageData.data) return null

        // first page, we don't have `previousPageData`
        if (pageIndex === 0) return url

        const { limit } = previousPageData

        // add the cursor to the API endpoint
        return url + `&offset=${pageIndex * limit}`
    }, [url])

    const swr = useSWRInfinite(url && getKey, {
        fetcher: getAPI,
        ...config
    })

    return swr
}

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} url - The query to fetch
 * @param {import("swr").SWRConfiguration} config - The SWR config
 * @param {boolean} infinite - Whether to use infinite scrolling
 * @returns {import("swr").SWRResponse} The SWR response
 */
export function useCache(url, config) {
    const { getAPI } = useAPI()

    const swr = useSWR(url, {
        fetcher: getAPI,
        ...config
    })

    return swr
}
