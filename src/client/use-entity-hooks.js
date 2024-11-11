import { useEffect, useState, useMemo, useCallback } from "react"
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"
import useSWR, { useSWRConfig } from "swr"
import useSWRInfinite from 'swr/infinite'
import { v4 } from "uuid"
import { usePeers } from "./use-peers"

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
 * @returns {() => void} The function to clear the cache
 */
export function useClearCache() {
    const { cache } = useSWRConfig()

    const clearCache = useCallback(() => {
        for (let key of cache.keys()) cache.delete(key)
    }, [cache])

    return clearCache
}

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
    const entity = useMemo(() => id ? data : data?.data?.[0], [data])

    useEffect(() => {
        // console.log("useEntity", path, data)
    }, [data])

    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const { mutate } = useSWRConfig()

    const mutateEntity = useCallback((entity, opts) => {
        if (entity == undefined) {
            return mutate(path)
        }

        return mutate(path, entity, opts)
    }, [data])

    const update = useCallback(async (fields) => {
        if (!entity) return { error: new Error("Entity not found") }
        return await updateEntity(table, id, entity, fields, params)
    }, [data])

    const doDelete = useCallback(async () => {
        return await deleteEntity(table, id, params)
    }, [data])

    return { ...swrResponse, entity, updateEntity: update, deleteEntity: doDelete, mutate: mutateEntity, mutateEntity }
}


/**
 * @typedef {object} EntitiesResponseType
 * @property {object[]} entities - The entities
 * @property {number} count - The total count of entities
 * @property {number} limit - The limit of entities per page
 * @property {number} offset - The current offset
 * @property {boolean} hasMore - Whether there are more entities
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
    const { data, isValidating } = swrResponse
    const { data: entities, count, limit, offset, has_more: hasMore } = data || {}
    const { mutate } = useSWRConfig()
    const [addEntity, setAddEntity] = useState(null)
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const createEntity = useCreateEntity()
    const session = useSession()

    const mutateEntities = useCallback((entities, opts) => {
        if (entities == undefined) {
            return mutate(path)
        }

        mutateChildren(entities)
        return mutate(path, { data: entities, count, limit, offset, has_more: hasMore }, opts)
    }, [entities])

    // Mutate the individual entities directly to the cache
    const mutateChildren = useCallback((entities) => {
        entities?.forEach((entity) => {
            const path = apiPath(table, entity.id, params?.lang ? { lang: params.lang } : null)
            mutate(path, entity, false)
        })
    }, [])

    useEffect(() => {
        if (isValidating) return

        mutateChildren(entities)
    }, [isValidating])

    // Fix for delayed updates
    useEffect(() => {
        if (!addEntity) return
        setAddEntity(null)
        mutateEntities([...entities?.filter(e => e.id != addEntity.id), addEntity], false)
    }, [addEntity])

    const create = useCallback(async (entity) => {
        if (!session) {
            console.error("User not authenticated")
            return { error: new Error("User not authenticated") }
        }

        // Mutate the new entity directly to the parent cache
        const newEntity = { ...entity, user_id: session.user.id }
        if (!newEntity.id) newEntity.id = v4()

        mutateEntities([...entities, newEntity], false)

        // Create the entity via API
        const response = await createEntity(table, newEntity)
        if (response.error) mutateEntities()
        if (response.entity) setAddEntity(response.entity)

        return response
    }, [entities])

    const update = useCallback(async (entity, fields) => {
        const newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the parent cache
        mutateEntities(entities?.map(e => e.id == entity.id ? newEntity : e), false)

        // Update the entity via API
        const response = await updateEntity(table, entity.id, entity, fields)
        if (response.error) mutateEntities()

        return response
    }, [entities])

    const doDelete = useCallback(async (id) => {
        // Mutate the entity deletion directly to the parent cache
        mutateEntities(entities?.filter(e => e.id != id), false)

        // Delete the entity via API
        const response = await deleteEntity(table, id)
        if (response.error) mutateEntities()

        return response
    }, [entities])

    return {
        ...swrResponse,
        entities,
        count,
        limit,
        offset,
        hasMore,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        mutate: mutateEntities,
        mutateEntities
    }
}

/**
 * @typedef {object} InfiniteEntitiesResponseType
 * @property {object[]} entities - The entities
 * @property {number} count - The total count of entities
 * @property {number} limit - The limit of entities per page
 * @property {number} offset - The current offset
 * @property {boolean} has_more - Whether there are more entities
 * @property {(entity: object) => Promise<{error: Error, entity: object}>} createEntity - The function to create an entity
 * @property {(entity: object, fields: object) => Promise<{error: Error}>} updateEntity - The function to update an entity
 * @property {(id: string) => Promise<{error: Error}>} deleteEntity - The function to delete an entity
 * @property {(entity: object) => void} insertEntity - The function to insert an entity
 * @property {(entity: object) => void} mutateEntity - The function to mutate an entity
 * @property {(id: string) => void} removeEntity - The function to remove an entity
 * @typedef {import("swr/infinite").SWRInfiniteResponse & InfiniteEntitiesResponseType} InfiniteEntitiesResponse
 */


function usePeerJS(table, params, options, entities, insertEntity, mutateEntity, removeEntity) {
    const onData = useCallback((data, connection, peer) => {
        if (!peer) return

        options.onData && options.onData(data, connection, peer)

        switch (data.action) {
            case "create_entity": {
                const entity = data.data
                if (!entity) return

                // Don't allow invalid messages from invalid peers
                if (entity.user_id != peer.user_id) return

                insertEntity({ ...entity, user: peer.user })
                break
            }
            case "update_entity": {
                const { id, fields } = data.data
                const entity = entities.find((entity) => entity.id == id)
                if (entity?.user_id != peer.user_id) return

                mutateEntity({ ...entity, ...fields })
                break
            }
            case "delete_entity": {
                const { id } = data.data
                const entity = entities.find((entity) => entity.id == id)
                if (entity?.user_id != peer.user_id) return

                removeEntity(id)
                break
            }
        }
    }, [entities, options])

    return usePeers({
        enabled: options?.realtime == "peerjs",
        onData,
        room: `${table}`
    })
}


/**
 * Hook for fetching entities with infinite scrolling support
 * @param {string} table - The table name
 * @param {object} [params] - The query parameters
 * @param {import("swr").SWRConfiguration} [swrConfig] - The SWR config
 * @param {object} [options] - The query parameters
 * @returns {InfiniteEntitiesResponse} The entity and functions to update and delete it
 */
export function useInfiniteEntities(table, params = null, swrConfig = null, options = null) {
    const path = apiPath(table, null, params)
    const swrResponse = useInfiniteCache(path, swrConfig)
    const { data: pages, mutate: mutatePages, isValidating } = swrResponse

    const entities = useMemo(() => pages?.map(page => page.data).flat()
        .filter((entity, index, self) =>
            index === self.findIndex((t) => (
                t.id === entity.id
            ))
        ), [pages])

    const { offset, limit, has_more: hasMore, count } = useMemo(() => pages?.[pages.length - 1] || {}, [pages])

    const { mutate } = useSWRConfig()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const createEntity = useCreateEntity()
    const session = useSession()

    const insertEntity = useCallback((entity) => {
        if (!entity || !pages?.length) return

        // Filter out this entity from all pages
        const newPages = JSON.parse(JSON.stringify(pages))
        newPages.forEach((page) => {
            page.data = page.data.filter((e) => e.id != entity.id)
        })

        newPages[0].data.push(entity)

        mutateChildren([entity])
        mutatePages(newPages, false)
    }, [entities])

    const mutateEntity = useCallback((entity) => {
        if (!entity || !pages) return

        // Find the page that has the entity and update the entity there and mutate that using mutatePages
        const newPages = JSON.parse(JSON.stringify(pages))
        newPages.forEach((page) => {
            page.data = page.data.map((e) => e.id == entity.id ? entity : e)
        })

        mutateChildren([entity])
        mutatePages(newPages, false)
    }, [entities])

    const removeEntity = useCallback((id) => {
        if (!id || !pages) return

        // Find the page that has the entity and remove the entity there and mutate that using mutatePages
        const newPages = JSON.parse(JSON.stringify(pages))
        newPages.forEach((page) => {
            page.data = page.data.filter((e) => e.id != id)
        })

        mutatePages(newPages, false)
    }, [entities])

    // Mutate the individual entities directly to the cache
    const mutateChildren = useCallback((entities) => {
        entities?.forEach((entity) => {
            const path = apiPath(table, entity.id, params?.lang ? { lang: params.lang } : null)
            mutate(path, entity, false)
        })
    }, [])

    useEffect(() => {
        if (isValidating) return

        const entities = pages?.map(page => page.data).flat()
            .filter((entity, index, self) =>
                index === self.findIndex((t) => (
                    t.id === entity.id
                ))
            )

        mutateChildren(entities)
    }, [isValidating])

    const create = useCallback(async (entity) => {
        if (!session) {
            console.error("User not authenticated")
            return { error: new Error("User not authenticated") }
        }

        // Mutate the new entity directly to the parent cache
        const newEntity = { ...entity, user_id: session.user.id }
        if (!newEntity.id) newEntity.id = v4()

        insertEntity(newEntity)

        // Create the entity via API
        const response = await createEntity(table, newEntity)
        if (response.error) removeEntity(newEntity.id)
        if (response.entity) {
            if (options?.realtime == "peerjs") {
                sendData({ action: "create_entity", data: response.entity })
            }

            insertEntity(response.entity)
        }

        return response
    }, [entities])

    const update = useCallback(async (entity, fields) => {
        const newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the parent cache
        mutateEntity(newEntity)

        // Update the entity via API
        const response = await updateEntity(table, entity.id, entity, fields)
        if (response.error) {
            mutateEntity(entity)
        } else if (options?.realtime == "peerjs") {
            sendData({ action: "update_entity", data: response.entity })
        }

        return response
    }, [entities])

    const doDelete = useCallback(async (id) => {
        const entity = entities.find(e => e.id == id)
        if (!entity) return

        // Mutate the entity deletion directly to the parent cache
        removeEntity(id)

        // Delete the entity via API
        const response = await deleteEntity(table, id)
        if (response.error) {
            insertEntity(entity)
        } else if (options?.realtime == "peerjs") {
            sendData({ action: "delete_entity", data: { id } })
        }

        return response
    }, [entities])

    const { sendData, isOnline } = usePeerJS(table, params, options, entities, insertEntity, mutateEntity, removeEntity)

    return {
        ...swrResponse,
        entities,
        count,
        limit,
        offset,
        hasMore,
        isOnline,
        sendData,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        insertEntity,
        mutateEntity,
        removeEntity
    }
}

/**
 * Hook for creating an entity
 * @returns {(table: string, entity: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to create an entity
 */
export function useCreateEntity() {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const createEntity = useCallback(async (table, entity = {}, params) => {
        if (!session) {
            console.error("User not authenticated")
            return { error: new Error("User not authenticated") }
        }

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
    }, [session])

    return createEntity
}

/**
 * Hook for updating an entity
 * @returns {(table: string, id: string, entity: object, fields: object, params: object?) => Promise<{error: Error?, entity: object?}>} The function to update an entity
 */
export function useUpdateEntity() {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const updateEntity = useCallback(async (table, id, entity, fields, params) => {
        let path = apiPath(table, id, params)
        let newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the cache
        mutate(path, newEntity, false)
        if (id != entity.id) {
            mutate(apiPath(table, entity.id, params), newEntity, false)
        }

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
            if (id != entity.id) {
                mutate(apiPath(table, entity.id, params), newEntity, false)
            }
        }

        return { entity: newEntity }
    }, [session])

    return updateEntity
}

/**
 * Hook for deleting an entity
 * @returns {(table: string, id: string, params: object?) => Promise<{error: Error?}>} The function to delete an entity
 */
export function useDeleteEntity() {
    const session = useSession()
    const { mutate } = useSWRConfig()

    const deleteEntity = useCallback(async (table, id, params) => {
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
    }, [session])

    return deleteEntity
}

/**
 * Hook for updating entities
 * @returns {(table: string, params: object, fields: object) => Promise<{error: Error?, [key: string]: any}>} The function to update entities
 */
export function useUpdateEntities() {
    const session = useSession()

    const updateEntities = useCallback(async (table, params, fields) => {
        const path = apiPath(table, null, params)

        // Update the entities via API
        const { error, ...response } = await patchAPI(session, path, fields)

        // Log and return any errors
        if (error) {
            console.error(error)
            return { error }
        }

        return response
    }, [session])

    return updateEntities
}

/**
 * Hook for deleting entities
 * @returns {(table: string, params: object) => Promise<{error: Error?, [key: string]: any}>} The function to delete entities
 */
export function useDeleteEntities() {
    const session = useSession()

    const deleteEntities = useCallback(async (table, params) => {
        const path = apiPath(table, null, params)

        // Delete the entity via API
        const { error, ...response } = await deleteAPI(session, path)

        // Log and return any errors
        if (error) {
            console.error(error)
            return { error }
        }

        return response
    }, [session])

    return deleteEntities
}

/**
 * Hook for mutating entities
 * @returns {(table: string, params: object, entities: object[], opts: import("swr").mutateOptions) => Promise<any>} The function to mutate entities
 */
export function useMutateEntities() {
    const { mutate } = useSWRConfig()

    const mutateEntities = useCallback((table, params, entities, opts) => {
        const path = apiPath(table, null, params)

        if (entities == undefined) {
            return mutate(path)
        }

        return mutate(path, { data: entities, count: entities.length, limit: 100, offset: 0, has_more: false }, opts)
    }, [])

    return mutateEntities
}

/**
 * Hook for mutating an entity
 * @returns {(table: string, id: string, entity: object) => Promise<any>} The function to mutate an entity
 */
export function useMutateEntity() {
    const { mutate } = useSWRConfig()

    const mutateEntity = useCallback((table, id, entity) => {
        const path = apiPath(table, id)

        if (entity == undefined) {
            return mutate(path)
        }

        return mutate(path, entity, false)
    }, [])

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