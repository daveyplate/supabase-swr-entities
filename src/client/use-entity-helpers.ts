import { useCallback } from "react"
import { BareFetcher, Revalidator, RevalidatorOptions, SWRConfig, useSWRConfig } from "swr"
import { useSession } from "@supabase/auth-helpers-react"
import { v4 } from "uuid"

import { apiPath } from "./client-utils"
import { useAPI } from "./api-methods"
import { PublicConfiguration } from "swr/_internal"

// TODO look into "lang" param.... and how that needs to be factored in for mutations

export function useCreateEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()
    const { postAPI } = useAPI()
    const swrConfig = useSWRConfig()
    const { onError } = swrConfig

    const createEntity = useCallback(async (
        table: string | null,
        entity: Record<string, any>,
        params?: Record<string, any>,
        optimisticFields?: Record<string, any>
    ): Promise<{ entity?: Record<string, any>, error?: Error }> => {
        if (!table) return { error: new Error("Entity not loaded") }

        const createParams = params && { ...params }
        const newEntity = { id: v4(), ...entity, locale: createParams?.lang }
        delete createParams?.limit
        delete createParams?.offset
        delete createParams?.order

        const mutateParams = createParams && { ...createParams }
        delete createParams?.lang

        const path = apiPath(table, null, createParams)!

        try {
            const entity = await mutateEntity(table, newEntity.id, async () => {
                return postAPI(path, newEntity)
            }, mutateParams, {
                optimisticData: { ...newEntity, ...optimisticFields },
                revalidate: false
            })

            return { entity }
        } catch (error) {
            onError(error, path, swrConfig)
            return { error: error as Error }
        }
    }, [session])

    return createEntity
}

export function useUpdateEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()
    const { patchAPI } = useAPI()
    const swrConfig = useSWRConfig()
    const { onError } = swrConfig

    const updateEntity = useCallback(async (
        table: string | null,
        id: string | null,
        fields: Record<string, any>,
        params?: Record<string, any>
    ): Promise<{ entity?: Record<string, any>, error?: Error }> => {
        if (!table) return { error: new Error("Entity not loaded") }

        const updateParams = params && { ...params }
        delete updateParams?.offset
        const mutateParams = updateParams && { ...updateParams }

        if (updateParams?.lang) {
            fields.locale = updateParams.lang
            delete updateParams.lang
        }

        const path = apiPath(table, id, updateParams)!

        try {
            const entity = await mutateEntity(table, id, async () => {
                return patchAPI(path, fields)
            }, mutateParams, {
                optimisticData: (entity: Record<string, any>) => ({ updated_at: new Date(), ...entity, ...fields }),
                revalidate: false
            })

            return { entity }
        } catch (error) {
            onError(error, path, swrConfig)
            return { error: error as Error }
        }
    }, [session])

    return updateEntity
}

export function useDeleteEntity() {
    const session = useSession()
    const mutateEntity = useMutateEntity()
    const { deleteAPI } = useAPI()
    const swrConfig = useSWRConfig()
    const { onError } = swrConfig

    const deleteEntity = useCallback(async (
        table: string | null,
        id: string | null,
        params?: Record<string, any>
    ): Promise<{ success?: boolean, error?: Error }> => {
        if (!table) return { error: new Error("Entity not loaded") }

        const deleteParams = params && { ...params }
        delete deleteParams?.offset
        const mutateParams = deleteParams && { ...deleteParams }
        delete deleteParams?.lang


        const path = apiPath(table, id, deleteParams)!

        try {
            await mutateEntity(table, id, async () => {
                await deleteAPI(path)
                return null
            }, mutateParams, {
                optimisticData: null,
                revalidate: false
            })
        } catch (error) {
            onError(error, path, swrConfig)
            return { error: error as Error }
        }

        return { success: true }
    }, [session])

    return deleteEntity
}

export function useUpdateEntities() {
    const session = useSession()
    const { patchAPI } = useAPI()
    const swrConfig = useSWRConfig()
    const { onError } = swrConfig

    const updateEntities = useCallback(async (
        table: string | null,
        params: Record<string, any>,
        fields: Record<string, any>
    ): Promise<{ success?: boolean, error?: Error }> => {
        if (!table) return { error: new Error("Entity not loaded") }

        const path = apiPath(table, null, params)!

        // Patch the entities via API
        try {
            await patchAPI(path, fields)
        } catch (error) {
            onError(error, path, swrConfig)
            return { error: error as Error }
        }

        return { success: true }
    }, [session])

    return updateEntities
}

export function useDeleteEntities() {
    const session = useSession()
    const { deleteAPI } = useAPI()
    const swrConfig = useSWRConfig()
    const { onError } = swrConfig

    const deleteEntities = useCallback(async (
        table: string | null,
        params: Record<string, any>
    ): Promise<{ success?: boolean, error?: Error }> => {
        if (!table) return { error: new Error("Entity not loaded") }

        const path = apiPath(table, null, params)!

        // Delete the entities via API
        try {
            await deleteAPI(path)
        } catch (error) {
            onError(error, path, swrConfig)
            return { error: error as Error }
        }

        return { success: true }
    }, [session])

    return deleteEntities
}

export function useMutateEntities() {
    const { mutate } = useSWRConfig()
    const session = useSession()

    const mutateEntities = useCallback(async (
        table: string | null,
        entities?: Record<string, any>[] | null,
        params?: Record<string, any>,
        opts: Record<string, any> | boolean = false
    ) => {
        if (!table) return { error: new Error("Entity not loaded") }

        const path = apiPath(table, null, params)

        if (!entities) {
            return mutate(path)
        }

        return mutate(path, {
            data: entities,
            count: entities?.length,
            limit: params?.limit || 100,
            offset: params?.offset || 0,
            has_more: params?.has_more || false
        }, opts)
    }, [session])

    return mutateEntities
}

export function useMutateEntity() {
    const { mutate } = useSWRConfig()
    const session = useSession()

    const mutateEntity = useCallback((
        table: string | null,
        id: string | null,
        data?: any | null,
        params?: Record<string, any> | null,
        opts: Record<string, any> | boolean = false
    ) => {
        if (!table) return { error: new Error("Entity not loaded") }

        const path = apiPath(table, id, params)

        if (data == undefined) return mutate(path) as Promise<Record<string, any>>

        return mutate(path, data, opts) as Promise<Record<string, any>>
    }, [session])

    return mutateEntity
}