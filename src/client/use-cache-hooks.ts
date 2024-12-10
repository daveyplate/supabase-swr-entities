import { useCallback } from "react"
import useSWR, { SWRConfiguration } from "swr"
import useSWRInfinite, { SWRInfiniteKeyLoader } from 'swr/infinite'
import { useAPI } from "./api-methods.js"

/**
 * Wraps useSWR with custom fetcher and getKey
 */
export function useInfiniteCache(url: string | null, config?: SWRConfiguration) {
    const { getAPI } = useAPI()

    const getKey: SWRInfiniteKeyLoader = useCallback((pageIndex: number, previousPageData: { data?: any; limit?: any }) => {
        if (!url) return null

        // reached the end
        if (previousPageData && !previousPageData.data) return null

        // first page, we don't have `previousPageData`
        if (pageIndex === 0) return url

        const { limit } = previousPageData

        // add the cursor to the API endpoint
        return url + `&offset=${pageIndex * limit}`
    }, [url])

    const swr = useSWRInfinite(getKey, {
        fetcher: getAPI,
        ...config
    })

    return swr
}

export function useCache(url: string | null, config?: SWRConfiguration) {
    const { getAPI } = useAPI()

    const swr = useSWR(url, {
        fetcher: getAPI,
        ...config
    })

    return swr
}
