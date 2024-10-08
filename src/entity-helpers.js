import { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { PostgrestFilterBuilder } from '@supabase/postgrest-js'

/**
 * Get a single entity from a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to get entity from
 * @param {string} id ID of the entity to get
 * @param {{}} params Additional parameters to apply to the query
 * @param {string[]} select Values to select
 * @returns {Promise<{entity: {}, error: PostgrestError?}>} Entity from the table or error
 */
export async function getEntity(supabase, entitySchemas, table, id, params = {}, select = null) {
    if (id && !params.id) {
        params.id = id
    }

    const { data, error } = await entityQuery(supabase, entitySchemas, table, "select", {}, params, select)

    if (error) {
        console.error(error)
        return { error }
    }

    return { entity: data?.length > 0 ? data[0] : null }
}

/**
 * Get entities from a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to get entities from
 * @param {{limit: number, offset: number, order: string, any}} params Parameters to apply to the query
 * @param {string[]} select Values to select
 * @returns {Promise<{entities: {}[], error: PostgrestError?}>} Entities from the table or error
 */
export async function getEntities(supabase, entitySchemas, table, params = {}, select = null) {
    const { data, error, count } = await entityQuery(supabase, entitySchemas, table, "select", {}, params, select)

    if (error) {
        console.error(error)
        return { error }
    }

    return { entities: data, count, limit: params.limit || 100, offset: params.offset || 0 }
}

/**
 * Create an entity in a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to create entity in
 * @param {{}} values Values to create the entity with
 * @param {string[]} select Fields to select
 * @returns {Promise<{entity: {}, error: PostgrestError?}>} Created entity or error
 */
export async function createEntity(supabase, entitySchemas, table, values = {}, select = null) {
    const { data, error } = await entityQuery(supabase, entitySchemas, table, "upsert", values, {}, select)

    if (error) {
        console.error(error)
        return { error }
    }

    return { entity: data[0] }
}

/**
 * Update an entity in a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to update entity in
 * @param {string} id ID of the entity to update
 * @param {{}} values Values to update the entity with
 * @param {{}} params Parameters to apply to the update query
 * @param {string[]} select Fields to select
 * @returns {Promise<{entity: {}, error: PostgrestError?}>} Updated entity or error
 */
export const updateEntity = async (supabase, entitySchemas, table, id, values = {}, params = {}, select = null) => {
    const { data, error } = await entityQuery(supabase, entitySchemas, table, "update", values, { id, ...params }, select)

    if (error) {
        console.error(error)
        return { error }
    }

    return { entity: data[0] }
}

/**
 * Update entities in a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to update entities in
 * @param {{}} values Values to update the entities with
 * @param {{}} params Parameters to apply to the update query
 * @returns {Promise<{result: {success: boolean}, error: PostgrestError?}>}  Updated entities or error
 */
export async function updateEntities(supabase, entitySchemas, table, values = {}, params = {}) {
    const { error } = await entityQuery(supabase, entitySchemas, table, "update", values, params)

    if (error) {
        console.error(error)
        return { error }
    }

    return { success: true }
}

/**
 * Delete an entity from a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to delete entity from
 * @param {string} id ID of the entity to delete
 * @param {{}} params Parameters to apply to the delete query
 * @returns {Promise<{result: {success: boolean}, error: PostgrestError?}>} Success status or error
 */
export async function deleteEntity(supabase, entitySchemas, table, id, params = {}) {
    const { error } = await entityQuery(supabase, entitySchemas, table, "delete", null, { id, ...params })

    if (error) {
        console.error(error)
        return { error }
    }

    return { success: true }
}

/**
 * Delete entities from a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to delete entity from
 * @param {{}} params Parameters to apply to the delete query
 * @returns {Promise<{success: boolean, error: PostgrestError?}>} Success status or error
 */
export async function deleteEntities(supabase, entitySchemas, table, params = {}) {
    const { error } = await entityQuery(supabase, entitySchemas, table, "delete", null, params)

    if (error) {
        console.error(error)
        return { error }
    }

    return { success: true }
}


/**
 * Build a query for a SQL table
 * @param {SupabaseClient} supabase Supabase client
 * @param {[{table: string, select: string[], defaultOrder: string, defaultParams: {}, authenticate: boolean}]} entitySchemas Entity schemas
 * @param {string} table SQL table to build query for
 * @param {string} method Method to use for the query
 * @param {{}} values Values to use in the query
 * @param {{}} params Parameters to apply to the query
 * @param {string[]} select Fields to select
 * @returns {PostgrestFilterBuilder} Query for the SQL table
 */
export function entityQuery(supabase, entitySchemas, table, method, values, params, select) {
    const entitySchema = entitySchemas.find(schema => schema.table === table)
    if (!entitySchema) return { error: 'Resource Not Found' }

    // Build query based on method
    let query

    if (method == "select") {
        query = supabase.from(table)
    } else if (method == "delete") {
        query = supabase.from(table).delete()
    } else if (method == "update") {
        query = supabase.from(table).update(values)
    } else if (method == "upsert") {
        query = supabase.from(table).upsert(values)
    }

    if (!query) return { error: 'Method not allowed' }

    // Select values with default fallback
    if (method != "delete" && (method != "update" || params.id)) {
        const selectValues = (select || entitySchema.select)?.join(', ')
        query = query.select(selectValues, { count: 'exact' })
    }

    // Sort order
    const order = params.order || entitySchema.defaultOrder

    if (order) {
        const orderParams = order.split(',')
        orderParams.forEach(param => {
            const isDesc = param.startsWith('-')
            const field = isDesc ? param.slice(1) : param
            query = query.order(field, { ascending: !isDesc })
        })
    } else if (method == "select") {
        // Default sorting if no order parameter is provided
        // query = query.order('created_at', { ascending: true })
    }

    // Pagination
    let { limit = method == "select" ? 100 : 0, offset = 0 } = params

    limit = Math.min(limit, 100)

    if (limit) {
        if (offset) {
            query = query.range(offset, parseInt(offset) + parseInt(limit) - 1)
        } else {
            query = query.limit(parseInt(limit))
        }
    }

    // Apply additional parameters to the query
    if (method != "upsert") {
        let newParams = params
        if (!params.id) {
            newParams = { ...entitySchema.defaultParams, ...params }
        }

        for (let [key, value] of Object.entries(newParams)) {
            if (['limit', 'offset', 'order'].includes(key)) continue

            if (key == 'or') {
                query = query.or(value)
            } else if (key.endsWith('_not')) {
                query = query.not(key.slice(0, -4), 'is', value)
            } else if (key.endsWith('_in')) {
                query = query.in(key.slice(0, -3), value.split(','))
            } else if (key.endsWith('_like')) {
                query = query.ilike(key.slice(0, -5), `%${value}%`)
            } else if (key.endsWith('_ilike')) {
                query = query.ilike(key.slice(0, -6), `%${value}%`)
            } else if (key.endsWith('_search')) {
                query = query.textSearch(key.slice(0, -7), `'${value}'`, { type: 'websearch' })
            } else if (key.endsWith('_gt')) {
                query = query.gt(key.slice(0, -3), value)
            } else if (key.endsWith('_lt')) {
                query = query.lt(key.slice(0, -3), value)
            } else if (key.endsWith('_gte')) {
                query = query.gte(key.slice(0, -3), value)
            } else if (key.endsWith('_lte')) {
                query = query.lte(key.slice(0, -3), value)
            } else if (key == "user_id") {
                query = query.or(`user_id.eq.${value},user_id.is.null`)
            } else if (value == "null" || value == null) {
                query = query.is(key, null)
            } else {
                query = query.eq(key, value)
            }
        }
    }

    return query
}