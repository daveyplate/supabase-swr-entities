import { useSession } from "@supabase/auth-helpers-react"
import { isExport } from "./client-utils"
import { useCallback } from "react"

/**
 * Hook for using the API
 * @returns {{postAPI: (path: string, params: object) => Promise<object>, patchAPI: (path: string, params: object) => Promise<object>, deleteAPI: (path: string) => Promise<object>}} The API functions
 */
export function useAPI() {
    const session = useSession()

    const postAPI = useCallback(async (path, params) => {
        const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
        const url = baseUrl + path

        return fetch(url, {
            method: 'POST',
            headers: (isExport() && session) ? {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            } : { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        }).then(res => res.json())
    }, [session])

    const patchAPI = useCallback(async (path, params) => {
        const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
        const url = baseUrl + path

        return fetch(url, {
            method: 'PATCH',
            headers: (isExport() && session) ? {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            } : { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        }).then(res => res.json())
    }, [session])

    const deleteAPI = useCallback(async (path) => {
        const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
        const url = baseUrl + path

        return fetch(url, {
            method: 'DELETE',
            headers: (isExport() && session) ? {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            } : { 'Content-Type': 'application/json' }
        }).then(res => res.json())
    }, [session])

    return { postAPI, patchAPI, deleteAPI }
}