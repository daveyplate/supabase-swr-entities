import { useEffect, useState } from "react"
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"
import useSWR, { useSWRConfig } from "swr"
import { v4 } from "uuid"

/** 
 * Hook for clearing cache 
 * @returns {() => void} The function to clear the cache
 */
export function useClearCache() {
    const { cache } = useSWRConfig()

    const clearCache = () => {
        for (let key of cache.keys()) cache.delete(key)
    }

    return clearCache
}

/**
 * Wraps useSWR with custom fetcher and isLoading when provider isn't ready
 * @param {string} query - The query to fetch
 * @param {import("swr").SWRConfiguration} config - The SWR config
 * @returns {import("swr").SWRResponse} The SWR response
 */
export function useCache(query, config) {
    const session = useSession()
    const supabase = useSupabaseClient()
    const { provider } = useSWRConfig()

    const fetcher = async (url) => {
        const headers = {}
        let basePath = ""

        // Use base URL for export
        if (isExport()) {
            // Pass session access token
            if (session?.access_token) {
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

            throw new Error(res.statusText)
        }
    }

    const swr = useSWR(provider ? query : null, { fetcher, ...config })

    return { ...swr, isLoading: swr.isLoading || !provider }
}

/**
 * @typedef {object} EntityResponseType
 * @property {object} entity - The entity
 * @property {(fields: object) => Promise<{error: Error, entity: object}>} updateEntity - The function to update the entity
 * @property {() => Promise<{error: Error}>} deleteEntity - The function to delete the entity
 * @property {(entity: object, opts: import("swr").mutateOptions) => void} mutateEntity - The function to mutate the entity
 * @typedef {import("swr").SWRResponse & EntityResponseType} EntityResponse
 */

/**
 * Hook for fetching an entity by ID
 * @param {string} table - The table name
 * @param {string} id - The entity ID
 * @param {object} params - The query parameters
 * @param {import("swr").SWRConfiguration} swrConfig - The SWR config
 * @returns {EntityResponse} The entity and functions to update and delete it
 */
export function useEntity(table, id, params = null, swrConfig = null) {
    const path = apiPath(table, id, params)
    const swrResponse = useCache(path, swrConfig)
    const { data } = swrResponse

    let entity

    if (id) {
        entity = data
    } else {
        entity = data?.data?.[0]
    }

    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const { mutate } = useSWRConfig()

    const mutateEntity = (entity, opts) => {
        if (entity == undefined) {
            return mutate(path)
        }

        return mutate(path, entity, opts)
    }

    const update = async (fields) => {
        if (!entity) return { error: new Error("Entity not found") }
        return await updateEntity(table, entity, fields, params)
    }

    const doDelete = async () => {
        return await deleteEntity(table, id, params)
    }

    return { ...swrResponse, entity, updateEntity: update, deleteEntity: doDelete, mutate: mutateEntity, mutateEntity }
}


/**
 * @typedef {object} EntitiesResponseType
 * @property {object[]} entities - The entities
 * @property {number} count - The total count of entities
 * @property {number} limit - The limit of entities per page
 * @property {number} offset - The current offset
 * @property {boolean} has_more - Whether there are more entities
 * @property {(entity: object) => Promise<{error: Error, entity: object}>} createEntity - The function to create an entity
 * @property {(entity: object, fields: object) => Promise<{error: Error}>} updateEntity - The function to update an entity
 * @property {(id: string) => Promise<{error: Error}>} deleteEntity - The function to delete an entity
 * @property {(entities: object[], opts: import("swr").mutateOptions) => void} mutateEntities - The function to mutate the entities
 * @typedef {import("swr").SWRResponse & EntitiesResponseType} EntitiesResponse
 */

/**
 * Hook for fetching entities
 * @param {string} table - The table name
 * @param {object} params - The query parameters
 * @param {import("swr").SWRConfiguration} swrConfig - The SWR config
 * @returns {EntitiesResponse} The entity and functions to update and delete it
 */
export function useEntities(table, params = null, swrConfig = null) {
    const path = apiPath(table, null, params)
    const swrResponse = useCache(path, swrConfig)
    const { data } = swrResponse
    const { data: entities, count, limit, offset, has_more } = data || {}
    const { mutate } = useSWRConfig()
    const [addEntity, setAddEntity] = useState(null)
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const createEntity = useCreateEntity()
    const session = useSession()

    const mutateEntities = (entities, opts) => {
        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, { data: entities, count, limit, offset, has_more }, opts)
    }

    useEffect(() => {
        // Mutate the individual entities directly to the cache
        entities?.forEach(entity => {
            const path = apiPath(table, entity.id)
            mutate(path, entity, false)
        })
    }, [entities])

    // Fix for delayed updates
    useEffect(() => {
        if (!addEntity) return
        setAddEntity(null)
        mutateEntities([...entities?.filter(e => e.id != addEntity.id), addEntity], false)
    }, [addEntity])

    const create = async (entity) => {
        // Mutate the new entity directly to the parent cache
        const newEntity = { ...entity, user_id: session.user.id }
        if (!newEntity.id) newEntity.id = v4()

        mutateEntities([...entities, newEntity], false)

        // Create the entity via API
        const response = await createEntity(table, newEntity)
        if (response.error) mutateEntities()
        if (response.data?.id) setAddEntity(response.data)

        return response
    }

    const update = async (entity, fields) => {
        const newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the parent cache
        mutateEntities(entities.map(e => e.id == entity.id ? newEntity : e), false)

        // Update the entity via API
        const response = await updateEntity(table, entity, fields)
        if (response.error) mutateEntities()

        return response
    }

    const doDelete = async (id) => {
        // Mutate the entity deletion directly to the parent cache
        mutateEntities(entities.filter(e => e.id != id), false)

        // Delete the entity via API
        const response = await deleteEntity(table, id)
        if (response.error) mutateEntities()

        return response
    }

    return {
        ...swrResponse,
        entities,
        count,
        limit,
        offset,
        has_more,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        mutate: mutateEntities,
        mutateEntities
    }
}

/**
 * Hook for creating an entity
 * @returns {(table: string, entity: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to create an entity
 */
export function useCreateEntity() {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const createEntity = async (table, entity = {}, params) => {
        let newEntity = { ...entity, user_id: session.user.id }
        if (!newEntity.id) newEntity.id = v4()

        // Mutate the entity directly to cache
        const mutatePath = apiPath(table, newEntity.id, params)
        mutate(mutatePath, newEntity, false)

        // Create the entity via API
        const path = apiPath(table, null, params)
        const { error, ...response } = await postAPI(session, path, newEntity)

        // Log and return any errors
        if (error) {
            console.error(error)
            mutate(mutatePath, null, false)

            return { error }
        }

        // Mutate the entity with the response data
        if (response.id) {
            newEntity = response
            const mutatePath = apiPath(table, newEntity.id, params)

            mutate(mutatePath, newEntity, false)
        }

        // Return the result
        return { entity: newEntity }
    }

    return createEntity
}

/**
 * Hook for updating an entity
 * @returns {(table: string, entity: object, fields: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to update an entity
 */
export function useUpdateEntity() {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const updateEntity = async (table, entity, fields, params) => {
        // Only allow users to update "me" entity
        let entityId = entity.id
        if (table == "users" || table == "profiles") {
            entityId = "me"
        }

        let path = apiPath(table, entityId, params)
        let newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the cache
        mutate(path, newEntity, false)

        // Update the entity via API
        const { error, ...response } = await patchAPI(session, path, fields)

        // Log and return any errors
        if (error) {
            console.error(error)
            mutate(path, entity, false)

            return { error }
        }

        // Mutate the entity with the response data
        if (response.id) {
            newEntity = response
            mutate(path, newEntity, false)
        }

        return { entity: newEntity }
    }

    return updateEntity
}

/**
 * Hook for deleting an entity
 * @returns {(table: string, id: string, params: object?) => Promise<{error: Error?}>} The function to delete an entity
 */
export function useDeleteEntity() {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const deleteEntity = async (table, id, params) => {
        const path = apiPath(table, id, params)

        // Mutate the entity changes directly to the cache
        mutate(path, null, false)

        // Delete the entity via API
        const { error, ...response } = await deleteAPI(session, path)

        // Log and return any errors
        if (error) {
            console.error(error)
            mutate(path)
            return { error }
        }

        return response
    }

    return deleteEntity
}

/**
 * Hook for updating entities
 * @returns {(table: string, params: object, fields: object) => Promise<{error: Error?, [key: string]: any}>} The function to update entities
 */
export function useUpdateEntities() {
    const session = useSession()

    const updateEntities = async (table, params, fields) => {
        const path = apiPath(table, null, params)

        // Update the entities via API
        const { error, ...response } = await patchAPI(session, path, fields)

        // Log and return any errors
        if (error) {
            console.error(error)
            return { error }
        }

        return response
    }

    return updateEntities
}

/**
 * Hook for deleting entities
 * @returns {(table: string, params: object) => Promise<{error: Error?, [key: string]: any}>} The function to delete entities
 */
export function useDeleteEntities() {
    const session = useSession()

    const deleteEntities = async (table, params) => {
        const path = apiPath(table, null, params)

        // Delete the entity via API
        const { error, ...response } = await deleteAPI(session, path)

        // Log and return any errors
        if (error) {
            console.error(error)
            return { error }
        }

        return response
    }

    return deleteEntities
}

/**
 * Hook for mutating entities
 * @returns {(table: string, params: object, entities: object[], opts: import("swr").mutateOptions) => Promise<any>} The function to mutate entities
 */
export function useMutateEntities() {
    const { mutate } = useSWRConfig()

    const mutateEntities = (table, params, entities, opts) => {
        const path = apiPath(table, null, params)

        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, { data: entities, count: entities.length, limit: 100, offset: 0, has_more: false }, opts)
    }

    return mutateEntities
}

/**
 * Hook for mutating an entity
 * @returns {(table: string, id: string, entity: object) => Promise<any>} The function to mutate an entity
 */
export function useMutateEntity() {
    const { mutate } = useSWRConfig()

    const mutateEntity = (table, id, entity) => {
        const path = apiPath(table, id)

        if (entity == undefined) {
            return mutate(path)
        }

        return mutate(path, entity, false)
    }

    return mutateEntity
}

/**
 * Generate API path
 * @param {string} table - The table name
 * @param {string} id - The entity ID
 * @param {object} params - The query parameters
 * @returns {string} The API path
 */
function apiPath(table, id, params) {
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
 * Make a POST request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @param {object} params - The parameters to send with the request.
 * @returns {Promise<{error: Error?, [key: string]: any}>} A promise that resolves with the API response or error key.
 */
export async function postAPI(session, path, params) {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return fetch(url, {
        method: 'POST',
        headers: isExport() ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    }).then((res) => res.json()).catch((error) => { error })
}

/**
 * Make a PATCH request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @param {object} params - The parameters to send with the request.
 * @returns {Promise<{error: Error?, [key: string]: any}>} A promise that resolves with the API response or error key.
 */
export async function patchAPI(session, path, params) {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return fetch(url, {
        method: 'PATCH',
        headers: isExport() ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    }).then((res) => res.json()).catch((error) => { error })

}

/**
 * Make a DELETE request to the API.
 * @param {object} session - The session object.
 * @param {string} path - The API path.
 * @returns {Promise<{error: Error?, [key: string]: any}>} A promise that resolves with the API response or error key.
 */
export async function deleteAPI(session, path) {
    const baseUrl = isExport() ? process.env.NEXT_PUBLIC_BASE_URL : ""
    const url = baseUrl + path

    return fetch(url, {
        method: 'DELETE',
        headers: isExport() ? {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        } : { 'Content-Type': 'application/json' }
    }).then((res) => res.json()).catch((error) => { error })
}

/**
 * Check if the app is being exported.
 * @returns {boolean} True if NEXT_PUBLIC_IS_EXPORT is "1" or NEXT_PUBLIC_IS_MOBILE is "true".
 */
function isExport() {
    return process.env.NEXT_PUBLIC_IS_EXPORT == '1' || process.env.NEXT_PUBLIC_IS_MOBILE == 'true'
}