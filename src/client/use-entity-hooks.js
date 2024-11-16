import { useEffect, useMemo, useCallback } from "react"
import { SWRResponse, MutatorOptions, SWRConfiguration } from "swr"
import { SWRInfiniteResponse } from "swr/infinite"
import { useSession } from "@supabase/auth-helpers-react"
import { v4 } from "uuid"

import { usePeers, PeersResult } from "./use-peers"
import { apiPath } from "./client-utils"
import { useCreateEntity, useDeleteEntity, useMutateEntity, useUpdateEntity } from "./use-entity-helpers"
import { useCache, useInfiniteCache } from "./use-cache-hooks"

/**
 * @typedef {object} EntityResponseType
 * @property {object} entity - The entity
 * @property {(fields: object) => Promise<{error: Error, entity: object}>} updateEntity - The function to update the entity
 * @property {() => Promise<{error: Error}>} deleteEntity - The function to delete the entity
 * @property {(entity: object, opts: MutatorOptions<any, any>) => void} mutateEntity - The function to mutate the entity
 * @typedef {SWRResponse & EntityResponseType} EntityResponse
 */

/**
 * Hook for fetching an entity by ID or params
 * @param {string} table - The table name
 * @param {string} id - The entity ID
 * @param {object} params - The query parameters
 * @param {SWRConfiguration} swrConfig - The SWR config
 * @returns {EntityResponse} The entity and functions to update and delete it
 */
export function useEntity(table, id, params = null, swrConfig = null) {
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const path = apiPath(table, id, params)
    const swrResponse = useCache(path, swrConfig)
    const { data, mutate } = swrResponse

    const entity = useMemo(() => id ? data : data?.data?.[0], [data])

    const mutateEntity = useCallback((entity, opts) => {
        if (entity == undefined) {
            return mutate()
        }

        mutate(entity, opts)
    }, [entity])

    const update = useCallback(async (fields) => {
        if (!entity) return { error: new Error("Entity not found") }

        return updateEntity(table, id, entity, fields, params)
    }, [entity])

    const doDelete = useCallback(async () => {
        return deleteEntity(table, id, params)
    }, [entity])

    return {
        ...swrResponse,
        entity,
        updateEntity: update,
        deleteEntity: doDelete,
        mutate: mutateEntity,
        mutateEntity
    }
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
 * @property {(entities: object[]) => void} mutateEntities - The function to mutate the entities
 * @property {(entity: object) => void} insertEntity - The function to insert an entity
 * @property {(entity: object) => void} mutateEntity - The function to mutate an entity
 * @property {(id: string) => void} removeEntity - The function to remove an entity
 * @typedef {SWRResponse & EntitiesResponseType & PeersResult} EntitiesResponse
 * @typedef {SWRInfiniteResponse & EntitiesResponseType & PeersResult} InfiniteEntitiesResponse
 */

/**
 * Hook for fetching entities
 * @param {string} table - The table name
 * @param {object} params - The query parameters
 * @param {SWRConfiguration} swrConfig - The SWR config
 * @param {object} [realtimeOptions] - The Realtime options
 * @param {boolean} [realtimeOptions.enabled] - Whether Realtime is enabled
 * @param {string} [realtimeOptions.provider] - The Realtime provider
 * @param {string?} [realtimeOptions.room] - The Realtime room
 * @param {boolean} [realtimeOptions.listenOnly=false] - Whether to only listen for Realtime data
 * @returns {EntitiesResponse} The entity and functions to update and delete it
 */
export function useEntities(table, params = null, swrConfig = null, realtimeOptions = null) {
    const session = useSession()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const createEntity = useCreateEntity()
    const mutateChild = useMutateEntity()

    const path = apiPath(table, null, params)
    const swrResponse = useCache(path, swrConfig)
    const { data, isValidating, mutate } = swrResponse
    const { data: entities, count, limit, offset, has_more: hasMore } = useMemo(() => data || {}, [data])

    const mutateEntities = useCallback((entities) => {
        if (entities == undefined) {
            return mutate()
        }

        mutateChildren(entities)
        return mutate({ data: entities, count, limit, offset, has_more: hasMore }, false)
    }, [entities])

    // Reload the entities whenever realtime data is received
    const onData = useCallback(() => {
        // TODO throttling
        mutateEntities()
    }, [mutateEntities])

    const dataParams = params
    delete dataParams?.lang
    delete dataParams?.offset
    delete dataParams?.limit

    const roomName = Object.keys(dataParams || {}).length ? `${table}_${JSON.stringify(dataParams)}` : table

    // Initialize sendData variable
    const peersResult = realtimeOptions?.provider == "peerjs" ? usePeers({
        enabled: realtimeOptions?.enabled,
        onData,
        room: `${realtimeOptions?.room || roomName}`
    }) : {}

    const { sendData } = peersResult

    const insertEntity = useCallback((entity) => {
        if (!entity || !entities) return

        // Filter out this entity from all pages to prevent duplicates
        const newEntities = entities.filter((e) => e.id != entity.id)
        newEntities.push(entity)

        mutateChildren([entity])
        mutateEntities(newEntities, false)
    }, [entities])

    const mutateEntity = useCallback((entity) => {
        if (!entity || !entities) return

        // Find the page that has the entity and update the entity there and mutate that using mutatePages
        const newEntities = entities.map((e) => e.id == entity.id ? entity : e)

        mutateChildren([entity])
        mutateEntities(newEntities, false)
    }, [entities])

    const removeEntity = useCallback((id) => {
        if (!id || !entities) return

        // Find the page that has the entity and remove the entity there and mutate that using mutatePages
        const newEntities = entities.filter((e) => e.id != id)

        mutateEntities(newEntities, false)
    }, [entities])

    // Mutate the individual entities directly to the cache
    const mutateChildren = useCallback((entities) => {
        entities?.forEach((entity) => {
            mutateChild(table, entity.id, entity, params?.lang ? { lang: params.lang } : null)
        })
    }, [])

    useEffect(() => {
        if (isValidating) return

        mutateChildren(entities)
    }, [isValidating])

    const create = useCallback(async (entity) => {
        // Mutate the new entity directly to the parent cache
        const newEntity = { ...entity, user_id: session?.user.id }
        if (!newEntity.id) newEntity.id = v4()

        insertEntity(newEntity)

        // Create the entity via API
        const response = await createEntity(table, newEntity)
        if (response.error) removeEntity(newEntity.id)
        if (response.entity) {
            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "create_entity" })
            }

            insertEntity(response.entity)
        }

        return response
    }, [entities, session, sendData])

    const update = useCallback(async (entity, fields) => {
        const newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the parent cache
        mutateEntity(newEntity)

        // Update the entity via API
        const response = await updateEntity(table, entity.id, entity, fields)
        if (response.error) {
            mutateEntity(entity)
        } else if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
            sendData({ action: "update_entity" })
        }

        return response
    }, [entities, session, sendData])

    const doDelete = useCallback(async (id) => {
        // Make sure this entity exists
        const entity = entities.find(e => e.id == id)
        if (!entity) return

        // Mutate the entity deletion directly to the parent cache
        removeEntity(id)

        // Delete the entity via API
        const response = await deleteEntity(table, id)
        if (response.error) {
            insertEntity(entity)
        } else if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
            sendData({ action: "delete_entity" })
        }

        return response
    }, [entities, session, sendData])

    return {
        ...swrResponse,
        ...peersResult,
        entities,
        count,
        limit,
        offset,
        hasMore,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        mutate: mutateEntities,
        mutateEntities,
        insertEntity,
        mutateEntity,
        removeEntity
    }
}

/**
 * Hook for fetching entities with infinite scrolling support
 * @param {string} table - The table name
 * @param {object} [params] - The query parameters
 * @param {SWRConfiguration} [swrConfig] - The SWR config
 * @param {object} [realtimeOptions] - The Realtime options
 * @param {boolean} [realtimeOptions.enabled] - Whether Realtime is enabled
 * @param {string} [realtimeOptions.provider] - The Realtime provider
 * @param {string?} [realtimeOptions.room] - The Realtime room
 * @param {boolean} [realtimeOptions.listenOnly=false] - Whether to only listen for Realtime data
 * @returns {InfiniteEntitiesResponse} The entity and functions to update and delete it
 */
export function useInfiniteEntities(table, params = null, swrConfig = null, realtimeOptions = null) {
    const session = useSession()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const createEntity = useCreateEntity()
    const mutateChild = useMutateEntity()

    // Load the entity pages using SWR
    const path = apiPath(table, null, params)
    const swrResponse = useInfiniteCache(path, swrConfig)
    const { data: pages, mutate: mutatePages, isValidating } = swrResponse

    // Memoize the merged pages into entities and filter out duplicates
    const entities = useMemo(() => pages?.map(page => page.data).flat()
        .filter((entity, index, self) =>
            index === self.findIndex((t) => (
                t.id === entity.id
            ))
        ), [pages])

    // Set the other vars from the final page
    const { offset, limit, has_more: hasMore, count } = useMemo(() => pages?.[pages.length - 1] || {}, [pages])

    // Reload the entities whenever realtime data is received
    const onData = useCallback(() => {
        // TODO throttling
        mutatePages()
    }, [mutatePages])

    const dataParams = params
    delete dataParams?.lang
    delete dataParams?.offset
    delete dataParams?.limit

    const roomName = Object.keys(dataParams || {}).length ? `${table}_${JSON.stringify(dataParams)}` : table

    // Initialize sendData variable
    const peersResult = realtimeOptions?.provider == "peerjs" ? usePeers({
        enabled: realtimeOptions?.enabled,
        onData,
        room: `${realtimeOptions?.room || roomName}`
    }) : {}

    const { sendData } = peersResult

    const insertEntity = useCallback((entity) => {
        if (!entity || !pages?.length) return

        // Filter out this entity from all pages to prevent duplicates
        const newPages = JSON.parse(JSON.stringify(pages))
        newPages.forEach((page) => {
            page.data = page.data.filter((e) => e.id != entity.id)
        })

        // Add the entity to the first page
        newPages[0].data.push(entity)

        mutateChildren([entity])
        mutatePages(newPages, false)
    }, [pages])

    const mutateEntity = useCallback((entity) => {
        if (!entity || !pages) return

        // Find the page that has the entity and update the entity there and mutate that using mutatePages
        const newPages = JSON.parse(JSON.stringify(pages))
        newPages.forEach((page) => {
            page.data = page.data.map((e) => e.id == entity.id ? entity : e)
        })

        mutateChildren([entity])
        mutatePages(newPages, false)
    }, [pages])

    const removeEntity = useCallback((id) => {
        if (!id || !pages) return

        // Find the page that has the entity and remove the entity there and mutate that using mutatePages
        const newPages = JSON.parse(JSON.stringify(pages))
        newPages.forEach((page) => {
            page.data = page.data.filter((e) => e.id != id)
        })

        mutatePages(newPages, false)
    }, [pages])

    // Mutate the individual entities directly to the cache
    const mutateChildren = useCallback((entities) => {
        entities?.forEach((entity) => {
            mutateChild(table, entity.id, entity, params?.lang ? { lang: params.lang } : null)
        })
    }, [])

    // Mutate all children entities after each validation
    useEffect(() => {
        if (isValidating) return

        mutateChildren(entities)
    }, [isValidating])

    const create = useCallback(async (entity) => {
        // Mutate the new entity directly to the parent cache
        const newEntity = { ...entity, user_id: session?.user.id }
        if (!newEntity.id) newEntity.id = v4()

        insertEntity(newEntity)

        // Create the entity via API
        const response = await createEntity(table, newEntity)
        if (response.error) removeEntity(newEntity.id)
        if (response.entity) {
            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "create_entity" })
            }

            insertEntity(response.entity)
        }

        return response
    }, [pages, session, sendData])

    const update = useCallback(async (entity, fields) => {
        const newEntity = { ...entity, ...fields }

        // Mutate the entity changes directly to the parent cache
        mutateEntity(newEntity)

        // Update the entity via API
        const response = await updateEntity(table, entity.id, entity, fields)
        if (response.error) {
            mutateEntity(entity)
        } else if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
            sendData({ action: "update_entity" })
        }

        return response
    }, [pages, session, sendData])

    const doDelete = useCallback(async (id) => {
        // Make sure this entity exists
        const entity = entities.find(e => e.id == id)
        if (!entity) return

        // Mutate the entity deletion directly to the parent cache
        removeEntity(id)

        // Delete the entity via API
        const response = await deleteEntity(table, id)
        if (response.error) {
            insertEntity(entity)
        } else if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
            sendData({ action: "delete_entity" })
        }

        return response
    }, [pages, session, sendData])

    return {
        ...swrResponse,
        ...peersResult,
        entities,
        count,
        limit,
        offset,
        hasMore,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        insertEntity,
        mutateEntity,
        removeEntity
    }
}