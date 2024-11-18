import { useSession } from "@supabase/auth-helpers-react"
import { isExport } from "./client-utils"
import { useCallback } from "react"


/**
 * @typedef {Object} APIFunctions
 * @property {(path: string) => Promise<object>} getAPI - The GET API function
 * @property {(path: string, params?: object) => Promise<object>} postAPI - The POST API function
 * @property {(path: string, params?: object) => Promise<object>} patchAPI - The PATCH API function
 * @property {(path: string) => Promise<object>} deleteAPI - The DELETE API function
 * @property {(path: string, method: string, params: object) => Promise<object>} requestAPI - The generic API function
 */

/**
 * Hook for using the API
 * @returns {APIFunctions} The API functions
 */
export function useAPI() {
    const session = useSession()

    const requestAPI = useCallback(async (path, method, params) => {
        const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
        const url = baseUrl + path

        const res = await fetch(url, {
            method,
            headers: (isExport() && session) ? {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            } : { 'Content-Type': 'application/json' },
            body: params && JSON.stringify(params)
        })

        if (!res.ok) {
            // Attach extra info to the error object.
            const json = await res.json()
            const error = new Error(json?.error?.message || 'An error occurred while fetching the data.')
            error.status = res.status

            console.error(error)
            throw error
        }

        return res.json()
    }, [session])

    const getAPI = useCallback(async (path) => requestAPI(path, 'GET'), [requestAPI])
    const postAPI = useCallback(async (path, params) => requestAPI(path, 'POST', params), [requestAPI])
    const patchAPI = useCallback(async (path, params) => requestAPI(path, 'PATCH', params), [requestAPI])
    const deleteAPI = useCallback(async (path) => requestAPI(path, 'DELETE'), [requestAPI])

    return { getAPI, postAPI, patchAPI, deleteAPI, requestAPI }
}