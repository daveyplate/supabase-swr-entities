import { useSession } from "@supabase/auth-helpers-react"
import { useCallback } from "react"
import { HTTP_METHOD } from "next/dist/server/web/http"
import { isExport } from "./client-utils"

interface APIFunctions {
    getAPI: (path: string) => Promise<Record<string, any>>
    postAPI: (path: string, body?: Record<string, any>) => Promise<Record<string, any>>
    patchAPI: (path: string, body?: Record<string, any>) => Promise<Record<string, any>>
    deleteAPI: (path: string) => Promise<Record<string, any>>
    requestAPI: (path: string, method: HTTP_METHOD, body?: Record<string, any>) => Promise<Record<string, any>>
}

export function useAPI(): APIFunctions {
    const session = useSession()

    const requestAPI = useCallback(async (path: string, method: HTTP_METHOD, body?: Record<string, any>) => {
        const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
        const url = baseUrl + path

        const res = await fetch(url, {
            method,
            headers: (isExport() && session) ? {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            } : { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        })

        if (!res.ok) {
            // Attach extra info to the error object.
            const json = await res.json()
            const error = new Error(json?.error?.message || `Failed to fetch ${path}`)

            console.error(error)
            throw error
        }

        return res.json()
    }, [session])

    const getAPI = useCallback(async (path: string) => requestAPI(path, 'GET'), [requestAPI])
    const postAPI = useCallback(async (path: string, body?: Record<string, any>) => requestAPI(path, 'POST', body), [requestAPI])
    const patchAPI = useCallback(async (path: string, body?: Record<string, any>) => requestAPI(path, 'PATCH', body), [requestAPI])
    const deleteAPI = useCallback(async (path: string) => requestAPI(path, 'DELETE'), [requestAPI])

    return { getAPI, postAPI, patchAPI, deleteAPI, requestAPI }
}