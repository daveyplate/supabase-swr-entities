import { useEffect, useMemo, useCallback } from "react"
import { SWRResponse, SWRConfiguration } from "swr"
import { SWRInfiniteResponse } from "swr/infinite"
import useSWRSubscription from 'swr/subscription'
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"
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
 * @typedef {SWRResponse & EntityResponseType} EntityResponse
 */

/**
 * Hook for fetching an entity by ID or params
 * @param {string} table - The table name
 * @param {string} id - The entity ID
 * @param {object} [params] - The query parameters
 * @param {SWRConfiguration} [swrConfig] - The SWR config
 * @returns {EntityResponse} The entity and functions to update and delete it
 */
export function useEntity(table, id, params = null, swrConfig = null) {
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const path = apiPath(table, id, params)
    const swr = useCache(path, swrConfig)
    const { data } = swr

    const entity = useMemo(() => id ? data : data?.data?.[0], [data])
    const update = useCallback(async (fields) => updateEntity(table, id, fields, params), [table, id, JSON.stringify(params)])
    const doDelete = useCallback(async () => deleteEntity(table, id, params), [table, id, JSON.stringify(params)])

    return {
        ...swr,
        entity,
        updateEntity: update,
        deleteEntity: doDelete
    }
}

/**
 * @typedef {object} EntitiesResponseType
 * @property {object[]} entities - The entities
 * @property {number} count - The total count of entities
 * @property {number} limit - The limit of entities per page
 * @property {number} offset - The current offset
 * @property {boolean} hasMore - Whether there are more entities
 * @property {(entity: object, optimisticFields?: object) => Promise<{entity?: object, error?: Error}>} createEntity - The function to create an entity
 * @property {(id: string, fields: object) => Promise<{entity?: object, error: Error}>} updateEntity - The function to update an entity
 * @property {(id: string) => Promise<{error?: Error}>} deleteEntity - The function to delete an entity
 * @property {(entity: object) => void} mutateEntity - The function to mutate an entity
 * @typedef {SWRResponse & EntitiesResponseType & PeersResult} EntitiesResponse
 * @typedef {SWRInfiniteResponse & EntitiesResponseType & PeersResult} InfiniteEntitiesResponse
 */

/**
 * Hook for fetching entities
 * @param {string} table - The table name
 * @param {object} [params] - The query parameters
 * @param {SWRConfiguration} [swrConfig] - The SWR config
 * @param {object} [realtimeOptions] - The Realtime options
 * @param {boolean} [realtimeOptions.enabled] - Whether Realtime is enabled
 * @param {string} [realtimeOptions.provider] - The Realtime provider
 * @param {string?} [realtimeOptions.room] - The Realtime room
 * @param {boolean} [realtimeOptions.listenOnly=false] - Whether to only listen for Realtime data
 * @returns {EntitiesResponse} The entity and functions to update and delete it
 */
export function useEntities(table, params = null, swrConfig = null, realtimeOptions = null) {
    const session = useSession()
    const supabase = useSupabaseClient()
    const createEntity = useCreateEntity()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const mutateChild = useMutateEntity()

    const path = apiPath(table, null, params)
    const swr = useCache(path, swrConfig)
    const { data, mutate } = swr
    const { data: entities, count, limit, offset, has_more: hasMore } = useMemo(() => data || {}, [data])

    // Reload the entities whenever realtime data is received
    const onData = useCallback(() => {
        mutate()
    }, [mutate])

    // Clean out the params for the room name
    const roomNameParams = params ? { ...params } : null
    delete roomNameParams?.lang
    delete roomNameParams?.offset
    delete roomNameParams?.limit

    const room = realtimeOptions?.room || (Object.keys(roomNameParams || {}).length ? `${table}:${JSON.stringify(roomNameParams)}` : table)

    const peersResult = realtimeOptions?.provider == "peerjs" ? usePeers({
        enabled: realtimeOptions?.enabled,
        onData,
        room
    }) : {}

    const { sendData } = peersResult


    // Supabase Realtime
    useEffect(() => {
        if (!realtimeOptions?.enabled) return
        if (realtimeOptions?.provider != "supabase") return

        const channelA = supabase.channel(room, { config: { private: true } })

        // Subscribe to the Channel
        channelA.on('broadcast',
            { event: 'create_entity' },
            ({ payload }) => mutate((prev) => appendEntity(prev, payload), false)
        ).on('broadcast',
            { event: 'update_entity' },
            ({ payload }) => mutate((prev) => appendEntity(prev, payload), false)
        ).on('broadcast',
            { event: 'delete_entity' },
            ({ payload }) => mutate((prev) => ({ ...prev, data: prev.data.filter((entity) => entity.id != payload.id) }), false)
        ).subscribe()

        return () => channelA.unsubscribe()
    }, [entities])

    // Mutate & precache all children entities on change
    useEffect(() => {
        entities?.forEach((entity) => {
            mutateChild(table, entity.id, entity, params?.lang ? { lang: params.lang } : null)
        })
    }, [table, entities, JSON.stringify(params)])

    // Append an entity to the data & filter out duplicates
    const appendEntity = useCallback((data, newEntity) => {
        const filteredEntities = data.data.filter((entity) => entity.id != newEntity.id)
        filteredEntities.push(newEntity)

        return {
            ...data,
            data: filteredEntities,
            count: filteredEntities.count
        }
    }, [])

    const mutateEntity = useCallback((entity) => {
        if (!entity || !data) return

        mutate(appendEntity(data, entity), false)
    }, [data])

    const create = useCallback(async (entity, optimisticFields = {}) => {
        const newEntity = { id: v4(), ...entity, user_id: session?.user.id, locale: params?.lang }

        try {
            const entity = await mutate(async () => {
                const { entity, error } = await createEntity(table, newEntity, params, optimisticFields)
                if (error) throw error

                return entity
            }, {
                populateCache: (entity, data) => appendEntity(data, entity),
                optimisticData: (data) => appendEntity(data, {
                    created_at: new Date(),
                    ...newEntity,
                    ...optimisticFields
                }),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "create_entity" })
            }

            return { entity }
        } catch (error) {
            return { error }
        }
    }, [session, sendData, JSON.stringify(params)])

    const update = useCallback(async (id, fields) => {
        try {
            const entity = await mutate(async () => {
                const { entity, error } = await updateEntity(table, id, fields, params)
                if (error) throw error

                return entity
            }, {
                populateCache: (entity, data) => appendEntity(data, entity),
                optimisticData: (data) => {
                    const entity = data.data.find((e) => e.id == id)
                    if (!entity) return data

                    return appendEntity(data, {
                        updated_at: new Date(),
                        ...entity,
                        ...fields
                    })
                },
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "update_entity" })
            }

            return { entity }
        } catch (error) {
            return { error }
        }
    }, [session, sendData, JSON.stringify(params)])

    const doDelete = useCallback(async (id) => {
        try {
            await mutate(async () => {
                const { error } = await deleteEntity(table, id, params)
                if (error) throw error
            }, {
                populateCache: (_, data) => ({ ...data, data: data.data.filter((e) => e.id != id) }),
                optimisticData: (data) => ({ ...data, data: data.data.filter((e) => e.id != id) }),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "delete_entity" })
            }
        } catch (error) {
            return { error }
        }
    }, [session, sendData, JSON.stringify(params)])

    return {
        ...swr,
        ...peersResult,
        entities,
        count,
        limit,
        offset,
        hasMore,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        mutateEntity
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
    const supabase = useSupabaseClient()
    const createEntity = useCreateEntity()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const mutateChild = useMutateEntity()

    // Load the entity pages using SWR
    const path = apiPath(table, null, params)
    const swr = useInfiniteCache(path, swrConfig)
    const { data: pages, mutate } = swr

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
        mutate()
    }, [mutate])

    // Clean out the params for the room name
    const roomNameParams = params ? { ...params } : null
    delete roomNameParams?.lang
    delete roomNameParams?.offset
    delete roomNameParams?.limit

    const room = realtimeOptions?.room || (Object.keys(roomNameParams || {}).length ? `${table}:${JSON.stringify(roomNameParams)}` : table)

    const peersResult = realtimeOptions?.provider == "peerjs" ? usePeers({
        enabled: realtimeOptions?.enabled,
        onData,
        room
    }) : {}

    const { sendData } = peersResult

    // Supabase Realtime
    useEffect(() => {
        if (!realtimeOptions?.enabled) return
        if (realtimeOptions?.provider != "supabase") return

        const channelA = supabase.channel(room, { config: { private: true } })

        // Subscribe to the Channel
        channelA.on('broadcast',
            { event: 'create_entity' },
            ({ payload }) => mutate((prev) => appendEntity(prev, payload), false)
        ).on('broadcast',
            { event: 'update_entity' },
            ({ payload }) => mutate((prev) => amendEntity(prev, payload), false)
        ).on('broadcast',
            { event: 'delete_entity' },
            ({ payload }) => mutate((prev) => JSON.parse(JSON.stringify(prev)).map((page) => {
                const filteredData = page.data.filter((entity) => entity.id != payload.id)
                return { ...page, data: filteredData }
            }), false)
        ).subscribe()

        return () => channelA.unsubscribe()
    }, [pages])

    // Mutate all children entities after each validation
    useEffect(() => {
        entities?.forEach((entity) => {
            mutateChild(table, entity.id, entity, params?.lang ? { lang: params.lang } : null)
        })
    }, [table, entities, JSON.stringify(params)])

    // Append an entity to the data & filter out duplicates
    const appendEntity = useCallback((data, newEntity) => {
        // Filter this entity from all pages then push it to the first page
        const filteredPages = JSON.parse(JSON.stringify(data)).map((page) => {
            const filteredData = page.data.filter((entity) => entity.id != newEntity.id)
            return { ...page, data: filteredData }
        })

        filteredPages[0].data.push(newEntity)

        return filteredPages
    }, [])

    const amendEntity = useCallback((data, newEntity) => {
        // Find this entity in a page and replace it with newEntity
        const amendedPages = JSON.parse(JSON.stringify(data)).map((page) => {
            const amendedData = page.data.map((entity) => entity.id == newEntity.id ? newEntity : entity)
            return { ...page, data: amendedData }
        })

        return amendedPages
    }, [])

    const mutateEntity = useCallback((entity) => {
        if (!entity || !pages) return

        mutate(amendEntity(pages, entity), false)
    }, [pages])

    const create = useCallback(async (entity, optimisticFields = {}) => {
        // Mutate the new entity directly to the parent cache
        const newEntity = { id: v4(), ...entity, user_id: session?.user.id }

        try {
            const entity = await mutate(async () => {
                const { entity, error } = await createEntity(table, newEntity, params, optimisticFields)
                if (error) throw error

                return entity
            }, {
                populateCache: (entity, data) => appendEntity(data, entity),
                optimisticData: (data) => appendEntity(data, {
                    created_at: new Date(),
                    ...newEntity,
                    ...optimisticFields
                }),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "create_entity" })
            }

            return { entity }
        } catch (error) {
            return { error }
        }
    }, [session, sendData, JSON.stringify(params)])

    const update = useCallback(async (id, fields) => {
        try {
            const entity = await mutate(async () => {
                const { entity, error } = await updateEntity(table, id, fields, params)
                if (error) throw error

                return entity
            }, {
                populateCache: (entity, data) => amendEntity(data, entity),
                optimisticData: (data) => {
                    const entity = data?.map(page => page.data).flat().find((e) => e.id == id)
                    if (!entity) return data

                    return appendEntity(data, {
                        updated_at: new Date(),
                        ...entity,
                        ...fields
                    })
                },
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "update_entity" })
            }

            return { entity }
        } catch (error) {
            return { error }
        }
    }, [session, sendData, JSON.stringify(params)])

    const doDelete = useCallback(async (id) => {
        try {
            await mutate(async () => {
                const { error } = await deleteEntity(table, id, params)
                if (error) throw error
            }, {
                populateCache: (_, data) => JSON.parse(JSON.stringify(data)).map((page) => {
                    const filteredData = page.data.filter((entity) => entity.id != id)
                    return { ...page, data: filteredData }
                }),
                optimisticData: (data) => JSON.parse(JSON.stringify(data)).map((page) => {
                    const filteredData = page.data.filter((entity) => entity.id != id)
                    return { ...page, data: filteredData }
                }),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ action: "delete_entity" })
            }
        } catch (error) {
            return { error }
        }
    }, [session, sendData, JSON.stringify(params)])

    return {
        ...swr,
        ...peersResult,
        entities,
        count,
        limit,
        offset,
        hasMore,
        createEntity: create,
        updateEntity: update,
        deleteEntity: doDelete,
        mutateEntity
    }
}