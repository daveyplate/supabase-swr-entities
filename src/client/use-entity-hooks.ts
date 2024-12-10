import { useEffect, useMemo, useCallback } from "react"
import { useSession, useSupabaseClient } from "@supabase/auth-helpers-react"
import { v4 } from "uuid"

import { PeersResult, usePeers } from "./use-peers"
import { apiPath } from "./client-utils"
import { useCreateEntity, useDeleteEntity, useMutateEntity, useUpdateEntity } from "./use-entity-helpers"
import { useCache, useInfiniteCache } from "./use-cache-hooks"
import { SWRConfiguration, SWRResponse } from "swr"
import { SWRInfiniteResponse } from "swr/infinite"

interface EntityResponse extends SWRResponse {
    entity: Record<string, any>
    updateEntity: (fields: Record<string, any>) => Promise<{ entity?: Record<string, any>, error?: Error }>
    deleteEntity: () => Promise<{ success?: boolean, error?: Error }>
}

/**
 * Hook for fetching an entity by `id` or params
 */
export function useEntity(
    table: string | null,
    id: string | null,
    params?: Record<string, any>,
    swrConfig?: SWRConfiguration
): EntityResponse {
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const mutateEntity = useMutateEntity()
    const path = apiPath(table, id, params)
    const swr = useCache(path, swrConfig)
    const { data } = swr

    const entity = useMemo<Record<string, any>>(() => id ? data : data?.data?.[0], [data])
    const update = useCallback(async (fields: Record<string, any>) => updateEntity(table, id, fields, params), [table, id, entity, JSON.stringify(params)])
    const doDelete = useCallback(async () => deleteEntity(table, id, params), [table, id, entity, JSON.stringify(params)])

    // Pre-mutate the entity for ID for "me" or in case that ID isn't set
    useEffect(() => {
        if (!entity) return
        if (id == entity?.id) return

        mutateEntity(table, entity.id, entity, params)
    }, [entity])

    return {
        entity,
        updateEntity: update,
        deleteEntity: doDelete,
        ...swr,
    }
}

interface EntitiesData {
    data: Record<string, any>[]
    count: number
    limit: number
    offset: number
    has_more: boolean
}

interface SharedEntitiesResponse {
    entities: Record<string, any>[]
    count: number
    limit: number
    offset: number
    hasMore: boolean
    createEntity: (entity: object, optimisticFields?: object) => Promise<{ entity?: object; error?: Error }>
    updateEntity: (id: string, fields: object) => Promise<{ entity?: object; error?: Error }>
    deleteEntity: (id: string) => Promise<{ error?: Error }>
    mutateEntity: (entity: object) => void
}

interface EntitiesResponse extends SharedEntitiesResponse, SWRResponse { }
interface InfiniteEntitiesResponse extends SharedEntitiesResponse, SWRInfiniteResponse { }

interface RealtimeOptions {
    enabled: boolean
    provider: "peerjs" | "supabase"
    room?: string
    listenOnly: boolean
}

/**
 * Hook for fetching entities
 * @param {string} table - The table name
 * @param {Record<string, any>} [params] - The query parameters
 * @param {SWRConfiguration} [swrConfig] - The SWR config
 * @param {RealtimeOptions} [realtimeOptions] - The Realtime options
 * @param {boolean} [realtimeOptions.enabled] - Whether Realtime is enabled
 * @param {string} [realtimeOptions.provider] - The Realtime provider
 * @param {string?} [realtimeOptions.room] - The Realtime room
 * @param {boolean} [realtimeOptions.listenOnly=false] - Whether to only listen for Realtime data
 */
export function useEntities(
    table: string | null,
    params?: Record<string, any>,
    swrConfig?: SWRConfiguration,
    realtimeOptions?: RealtimeOptions
): EntitiesResponse {
    const session = useSession()
    const supabase = useSupabaseClient()
    const createEntity = useCreateEntity()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const mutateChild = useMutateEntity()

    const path = apiPath(table, null, params)
    const swr = useCache(path, swrConfig)
    const { data, mutate } = swr
    const { data: entities, count, limit, offset, has_more: hasMore } = useMemo<EntitiesData>(() => data || {}, [data])

    // Reload the entities whenever realtime data is received
    const onData = useCallback(() => {
        mutate()
    }, [mutate])

    // Clean out the params for the room name
    const roomNameParams = params ? { ...params } : null
    delete roomNameParams?.lang
    delete roomNameParams?.offset
    delete roomNameParams?.limit

    const room = useMemo<string | undefined>(() => {
        return realtimeOptions?.room || (Object.keys(roomNameParams || {}).length ? `${table}:${JSON.stringify(roomNameParams)}` : table) || undefined
    }, [realtimeOptions?.room, JSON.stringify(params)])

    const peersResult = realtimeOptions?.provider == "peerjs" ? usePeers({
        enabled: realtimeOptions?.enabled,
        onData,
        room
    }) : { sendData: () => { } }

    const { sendData } = peersResult

    // Mutate & precache all children entities on change
    useEffect(() => {
        entities?.forEach((entity) => {
            mutateChild(table, entity.id, entity, params?.lang ? { lang: params.lang } : null)

            entity?.user && mutateChild("profiles", entity.user.id, entity.user, params?.lang ? { lang: params.lang } : null)
            entity?.sender && mutateChild("profiles", entity.sender.id, entity.sender, params?.lang ? { lang: params.lang } : null)
            entity?.recipient && mutateChild("profiles", entity.recipient.id, entity.recipient, params?.lang ? { lang: params.lang } : null)
        })
    }, [entities, mutateChild, table, JSON.stringify(params)])

    // Append an entity to the data & filter out duplicates
    const appendEntity = useCallback((data: Record<string, any>, newEntity: Record<string, any>) => {
        const filteredData = removeEntity(data, newEntity.id)
        filteredData.data.push(newEntity)

        return {
            ...filteredData,
            count: filteredData.data.count
        }
    }, [])

    const removeEntity = useCallback((data: Record<string, any>, id: string) => {
        const filteredEntities = data.data.filter((entity: Record<string, any>) => entity.id != id)

        return {
            ...data,
            data: filteredEntities,
            count: filteredEntities.count
        }
    }, [])

    const mutateEntity = useCallback((entity: Record<string, any>) => {
        if (!entity) return

        mutate((prev: Record<string, any>) => appendEntity(prev, entity), false)
    }, [mutate])

    // Supabase Realtime
    useEffect(() => {
        if (!realtimeOptions?.enabled || !room) return
        if (realtimeOptions?.provider != "supabase") return

        const channelA = supabase.channel(room, { config: { private: true } })

        // Subscribe to the Channel
        channelA.on('broadcast',
            { event: '*' },
            () => mutate()
        ).subscribe()

        return () => {
            channelA.unsubscribe()
        }
    }, [realtimeOptions?.enabled, realtimeOptions?.provider, mutate, room])

    const create = useCallback(async (
        entity: Record<string, any>,
        optimisticFields?: Record<string, any>
    ): Promise<{ entity?: Record<string, any>, error?: Error }> => {
        const newEntity = { id: v4(), ...entity, locale: params?.lang }

        try {
            const entity = await mutate(async () => {
                const { entity, error } = await createEntity(table, newEntity, params, optimisticFields)
                if (error) throw error

                return entity
            }, {
                populateCache: (entity, currentData) => appendEntity(currentData, entity),
                optimisticData: (currentData: Record<string, any>) => appendEntity(currentData, {
                    created_at: new Date(),
                    ...newEntity,
                    ...optimisticFields
                }),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ event: "create_entity" })
            }

            return { entity }
        } catch (error) {
            return { error: error as Error }
        }
    }, [
        session,
        mutate,
        createEntity,
        realtimeOptions?.enabled,
        realtimeOptions?.provider,
        realtimeOptions?.listenOnly,
        sendData,
        JSON.stringify(params)
    ])

    const update = useCallback(async (
        id: string,
        fields: Record<string, any>
    ): Promise<{ entity?: Record<string, any>, error?: Error }> => {
        try {
            const entity = await mutate(async () => {
                const { entity, error } = await updateEntity(table, id, fields, params)
                if (error) throw error

                return entity
            }, {
                populateCache: (entity, currentData) => appendEntity(currentData, entity),
                optimisticData: (currentData: Record<string, any>) => {
                    const entity = currentData.data.find((e: Record<string, any>) => e.id == id)
                    if (!entity) return data

                    return appendEntity(currentData, {
                        updated_at: new Date(),
                        ...entity,
                        ...fields
                    })
                },
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ event: "update_entity" })
            }

            return { entity }
        } catch (error) {
            return { error: error as Error }
        }
    }, [
        mutate,
        updateEntity,
        realtimeOptions?.enabled,
        realtimeOptions?.provider,
        realtimeOptions?.listenOnly,
        sendData,
        JSON.stringify(params)
    ])

    const doDelete = useCallback(async (id: string): Promise<{ success?: boolean, error?: Error }> => {
        try {
            await mutate(async () => {
                const { error } = await deleteEntity(table, id, params)
                if (error) throw error
            }, {
                populateCache: (_, currentData) => removeEntity(currentData, id),
                optimisticData: (currentData: Record<string, any>) => removeEntity(currentData, id),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ event: "delete_entity" })
            }
        } catch (error) {
            return { error: error as Error }
        }

        return { success: true }
    }, [
        mutate,
        deleteEntity,
        realtimeOptions?.enabled,
        realtimeOptions?.provider,
        realtimeOptions?.listenOnly,
        sendData,
        JSON.stringify(params)
    ])

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
 * @param {SWRConfiguration} [swrConfig] - The SWR config
 * @param {RealtimeOptions} [realtimeOptions] - The Realtime options
 * @param {boolean} [realtimeOptions.enabled] - Whether Realtime is enabled
 * @param {string} [realtimeOptions.provider] - The Realtime provider
 * @param {string} [realtimeOptions.room] - The Realtime room
 * @param {boolean} [realtimeOptions.listenOnly=false] - Whether to only listen for Realtime data
 */
export function useInfiniteEntities(
    table: string,
    params?: Record<string, any>,
    swrConfig?: SWRConfiguration,
    realtimeOptions?: RealtimeOptions
): InfiniteEntitiesResponse {
    const session = useSession()
    const supabase = useSupabaseClient()
    const createEntity = useCreateEntity()
    const updateEntity = useUpdateEntity()
    const deleteEntity = useDeleteEntity()
    const mutateChild = useMutateEntity()

    // Load the entity pages using SWR
    const path = apiPath(table, null, params)
    const swr = useInfiniteCache(path, swrConfig)
    const { data, mutate } = swr

    // Memoize the merged pages into entities and filter out duplicates
    const entities = useMemo<Record<string, any>[]>(() => data?.map(page => page.data).flat()
        .filter((entity, index, self) =>
            index === self.findIndex((t) => (
                t.id === entity.id
            ))
        ) || [], [data])

    // Set the other vars from the final page
    const { offset, limit, has_more: hasMore, count } = useMemo<EntitiesData>(() => data?.[data.length - 1] || {}, [data])

    // Reload the entities whenever realtime data is received
    const onData = useCallback(() => {
        mutate()
    }, [mutate])

    // Clean out the params for the room name
    const roomNameParams = params ? { ...params } : null
    delete roomNameParams?.lang
    delete roomNameParams?.offset
    delete roomNameParams?.limit

    const room = useMemo(() => {
        return realtimeOptions?.room || (Object.keys(roomNameParams || {}).length ? `${table}:${JSON.stringify(roomNameParams)}` : table)
    }, [realtimeOptions?.room, JSON.stringify(params)])

    const peersResult = realtimeOptions?.provider == "peerjs" ? usePeers({
        enabled: realtimeOptions?.enabled,
        onData,
        room
    }) : { sendData: () => { } }

    const { sendData } = peersResult

    // Mutate all children entities after each validation
    useEffect(() => {
        entities?.forEach((entity) => {
            mutateChild(table, entity.id, entity, params?.lang ? { lang: params.lang } : null)

            entity?.user && mutateChild("profiles", entity.user.id, entity.user, params?.lang ? { lang: params.lang } : null)
            entity?.sender && mutateChild("profiles", entity.sender.id, entity.sender, params?.lang ? { lang: params.lang } : null)
            entity?.recipient && mutateChild("profiles", entity.recipient.id, entity.recipient, params?.lang ? { lang: params.lang } : null)
        })
    }, [entities, mutateChild, table, JSON.stringify(params)])

    // Append an entity to the data & filter out duplicates
    const appendEntity = useCallback((data: Record<string, any>, newEntity: Record<string, any>) => {
        // Filter this entity from all pages then push it to the first page
        const filteredPages = removeEntity(data, newEntity.id)
        filteredPages[0].data.push(newEntity)

        return filteredPages
    }, [])

    const amendEntity = useCallback((data: Record<string, any>, newEntity: Record<string, any>) => {
        // Find this entity in a page and replace it with newEntity
        const amendedPages = data.map((page: Record<string, any>) => {
            const amendedData = page.data.map((entity: Record<string, any>) => entity.id == newEntity.id ? newEntity : entity)
            return { ...page, data: amendedData }
        })

        return amendedPages
    }, [])

    const removeEntity = useCallback((data: Record<string, any>, id: string) => {
        // Filter this entity from all pages
        return data.map((page: Record<string, any>) => {
            const filteredData = page.data.filter((entity: Record<string, any>) => entity.id != id)
            return { ...page, data: filteredData }
        })
    }, [])

    const mutateEntity = useCallback((entity: Record<string, any>) => {
        entity && mutate((prev) => amendEntity(prev as Record<string, any>, entity), false)
    }, [mutate])

    // Supabase Realtime
    useEffect(() => {
        if (!realtimeOptions?.enabled) return
        if (realtimeOptions?.provider != "supabase") return

        const channelA = supabase.channel(room, { config: { private: true } })

        // Subscribe to the Channel
        channelA.on('broadcast',
            { event: '*' },
            () => mutate()
        ).subscribe()

        return () => {
            channelA.unsubscribe()
        }
    }, [realtimeOptions?.enabled, realtimeOptions?.provider, room, mutate])

    const create = useCallback(async (
        entity: Record<string, any>,
        optimisticFields?: Record<string, any>
    ): Promise<{ entity?: Record<string, any>, error?: Error }> => {
        // Mutate the new entity directly to the parent cache
        const newEntity = { id: v4(), ...entity, locale: params?.lang }

        try {
            const entity = await mutate(async () => {
                const { entity, error } = await createEntity(table, newEntity, params, optimisticFields)
                if (error || !entity) throw error

                return [entity]
            }, {
                populateCache: (entities, currentData) => appendEntity(currentData as Record<string, any>, entities[0]),
                optimisticData: (currentData) => {
                    return appendEntity(currentData as Record<string, any>, {
                        created_at: new Date(),
                        ...newEntity,
                        ...optimisticFields
                    })
                },
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ event: "create_entity" })
            }

            return { entity }
        } catch (error) {
            return { error: error as Error }
        }
    }, [
        session,
        mutate,
        createEntity,
        realtimeOptions?.enabled,
        realtimeOptions?.provider,
        realtimeOptions?.listenOnly,
        sendData,
        JSON.stringify(params)
    ])

    const update = useCallback(async (
        id: string,
        fields: Record<string, any>
    ): Promise<{ entity?: Record<string, any>, error?: Error }> => {
        try {
            const entity = await mutate(async () => {
                const { entity, error } = await updateEntity(table, id, fields, params)
                if (error) throw error

                return [entity]
            }, {
                populateCache: (entities, currentData) => amendEntity(currentData as Record<string, any>, entities[0]),
                optimisticData: (currentData) => {
                    const entity = currentData?.map(page => page.data).flat().find((e) => e.id == id)
                    if (!entity) return currentData

                    return amendEntity(currentData as Record<string, any>, {
                        updated_at: new Date(),
                        ...entity,
                        ...fields
                    })
                },
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ event: "update_entity" })
            }

            return { entity }
        } catch (error) {
            return { error: error as Error }
        }
    }, [
        session,
        mutate,
        updateEntity,
        realtimeOptions?.enabled,
        realtimeOptions?.provider,
        realtimeOptions?.listenOnly,
        sendData,
        JSON.stringify(params)
    ])

    const doDelete = useCallback(async (id: string): Promise<{ success?: boolean, error?: Error }> => {
        try {
            await mutate(async () => {
                const { error } = await deleteEntity(table, id, params)
                if (error) throw error

                return []
            }, {
                populateCache: (_, currentData) => removeEntity(currentData as Record<string, any>, id),
                optimisticData: (currentData) => removeEntity(currentData as Record<string, any>, id),
                revalidate: false
            })

            if (realtimeOptions?.enabled && realtimeOptions?.provider == "peerjs" && !realtimeOptions?.listenOnly) {
                sendData({ event: "delete_entity" })
            }
        } catch (error) {
            return { error: error as Error }
        }

        return { success: true }
    }, [
        mutate,
        deleteEntity,
        realtimeOptions?.enabled,
        realtimeOptions?.provider,
        realtimeOptions?.listenOnly,
        sendData,
        JSON.stringify(params)
    ])

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