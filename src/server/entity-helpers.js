import path from 'path'
import { promises as fs } from 'fs'
import translate from '@iamtraction/google-translate'

import { PostgrestError } from '@supabase/supabase-js'
import { PostgrestFilterBuilder } from '@supabase/postgrest-js'

import defaultSchema from '../schemas/default.schema.json'
import usersSchema from '../schemas/users.schema.json'
import { createAdminClient } from '../supabase/service-role'
import { createNotification } from './notifications'

/**
 * Load an entity schema from entity.schemas.js
 * @param {string} table SQL table to load schema for
 * @returns {Promise<{entitySchema?: object, error?: Error}>} Entity schema or error
 */
export async function loadEntitySchema(table) {
    const entitySchemas = await loadEntitySchemas()
    const entitySchema = entitySchemas.find(schema => schema.table === table)
    if (!entitySchema) return { error: { message: `Schema Not Found: ${table}` } }

    let mergedSchema = { ...defaultSchema }

    if (entitySchema.usersSchema) {
        mergedSchema = { ...mergedSchema, ...usersSchema }
    }

    mergedSchema = { ...mergedSchema, ...entitySchema }

    return { entitySchema: mergedSchema }
}

/**
 * Load entity schemas from entity.schemas.js
 * @returns {Promise<object[]>} Entity schemas
 */
export async function loadEntitySchemas() {
    if (global.entitySchemas && process.env.NODE_ENV !== 'development') {
        return global.entitySchemas
    }

    const filePath = path.join(process.cwd(), 'entity.schemas.json');
    const file = await fs.readFile(filePath, 'utf8');

    global.entitySchemas = JSON.parse(file)
    return global.entitySchemas
}

/**
 * Translate an entity's localized fields using Google Translate
 * @param {string} table SQL table
 * @param {object} entity Entity to translate
 * @param {string} lang Language to translate to
 */
export async function translateEntity(table, entity, lang) {
    const entitySchemas = await loadEntitySchemas()
    const entitySchema = entitySchemas.find(schema => schema.table === table)
    const localizedColumns = entitySchema.localizedColumns || []

    const fromLocale = entity.locale

    const translatedFields = {}

    // Translate fields
    for (const key of localizedColumns) {
        if (entity[key]?.[fromLocale]) {
            if (!entity[key][lang]) {
                let localeValue = entity[key][fromLocale]

                if (!localeValue) {
                    fromLocale = Object.keys(entity[key])[0]
                    localeValue = user[key][fromLocale]
                }

                const translatedValue = await translate(localeValue, { from: fromLocale, to: lang })
                if (translatedValue.text?.length > 0) {
                    entity[key][lang] = translatedValue.text
                    translatedFields[key] = entity[key]
                }
            }
        }
    }

    // Clean out all locale fields that aren't fromLocale or lang
    for (const key of localizedColumns) {
        for (const locale in entity[key]) {
            if (![fromLocale, lang].includes(locale)) {
                delete entity[key][locale]
            }
        }
    }

    if (Object.keys(translatedFields).length > 0) {
        updateEntity(table, entity.id, translatedFields)
    }
}

/**
 * Get a single entity from a SQL table
 * @param {string} table SQL table to get entity from
 * @param {string} id ID of the entity to get
 * @param {object} [params={}] Additional parameters to apply to the query
 * @param {string[]} [select] Values to select
 * @returns {Promise<{entity?: object, error?: PostgrestError}>} Entity from the table or error
 */
export async function getEntity(table, id, params = {}, select = null) {
    const lang = params?.lang
    const { data, error } = await entityQuery(table, "select", {}, { id, ...params }, select)

    if (error) {
        console.error(error)
        return { error }
    }

    const entity = data[0]

    // Dynamic realtime translation
    if (lang) {
        await translateEntity(table, entity, lang)
    }

    return { entity }
}

/**
 * Get entities from a SQL table
 * @param {string} table SQL table to get entities from
 * @param {{limit: number, offset: number, order: string, [key: string]: any}} [params={}] Parameters to apply to the query
 * @param {string[]} [select] Values to select
 * @returns {Promise<{entities?: object[], count?: number, limit?: number, offset?: number, error?: PostgrestError}>} Entities from the table or error
 */
export async function getEntities(table, params = {}, select = null) {
    const lang = params?.lang

    const { data: entities, error, count } = await entityQuery(table, "select", {}, params, select)

    if (error) {
        console.error(error)
        return { error }
    }

    // Dynamic realtime translation
    if (lang) {
        await Promise.all(entities.map(async entity => {
            await translateEntity(table, entity, lang)
        }))
    }

    return { entities, count: parseInt(count), limit: parseInt(params.limit || 100), offset: parseInt(params.offset || 0) }
}

/**
 * Create an entity in a SQL table
 * @param {string} table SQL table to create entity in
 * @param {object} [values={}] Values to create the entity with
 * @param {string[]} [select] Fields to select
 * @returns {Promise<{entity?: object, error?: PostgrestError}>} Created entity or error
 */
export async function createEntity(table, values = {}, select = null) {
    const { data, error } = await entityQuery(table, "upsert", values, {}, select)

    if (error) {
        console.error(error)
        return { error }
    }

    const entity = data[0]

    await sendRealtime(table, "create_entity", entity)
    await createNotification(table, "upsert", entity)

    return { entity }
}

async function sendRealtime(table, event, payload) {
    const { entitySchema } = await loadEntitySchema(table)
    if (!entitySchema?.realtime && !entitySchema.realtimeParent) return

    if (entitySchema.realtimeParent) {
        const { entity } = await getEntity(
            entitySchema.realtimeParent.table,
            payload[entitySchema.realtimeParent.column]
        )

        if (entity) {
            await sendRealtime(entitySchema.realtimeParent.table, "update_entity", entity)
        }

        return
    }

    const room = entitySchema.realtimeIdentifier ?
        `${table}:${payload[entitySchema.realtimeIdentifier]}`
        : table
    const supabase = createAdminClient()
    const channel = supabase.channel(room, { config: { private: true } })

    // No need to subscribe to channel
    channel.send({
        type: 'broadcast',
        event,
        payload,
    })

    // Remember to clean up the channel
    supabase.removeChannel(channel)
}

/**
 * Update an entity in a SQL table
 * @param {string} table SQL table to update entity in
 * @param {string} id ID of the entity to update
 * @param {object} [values={}] Values to update the entity with
 * @param {object} [params={}] Parameters to apply to the update query
 * @param {string[]} [select] Fields to select
 * @returns {Promise<{entity?: object, error?: PostgrestError}>} Updated entity or error
 */
export const updateEntity = async (table, id, values = {}, params = {}, select = null) => {
    const { data, error } = await entityQuery(table, "update", values, { id, ...params }, select)

    if (error) {
        console.error(error)
        return { error }
    }

    const entity = data[0]

    await sendRealtime(table, 'update_entity', entity)

    return { entity }
}

/**
 * Update entities in a SQL table
 * @param {string} table SQL table to update entities in
 * @param {object} [values={}] Values to update the entities with
 * @param {object} [params={}] Parameters to apply to the update query
 * @returns {Promise<{entities?: boolean, error?: PostgrestError}>}  Updated entities or error
 */
export async function updateEntities(table, values = {}, params = {}) {
    const { data: entities, error } = await entityQuery(table, "update", values, params)

    if (error) {
        console.error(error)
        return { error }
    }

    await Promise.all(entities.map(async entity => {
        await sendRealtime(table, 'update_entity', entity)
    }))

    return { entities }
}

/**
 * Delete an entity from a SQL table
 * @param {string} table SQL table to delete entity from
 * @param {string} id ID of the entity to delete
 * @param {object} [params={}] Parameters to apply to the delete query
 * @returns {Promise<{entity?: object, error?: PostgrestError}>} Success status or error
 */
export async function deleteEntity(table, id, params = {}) {
    const { data, error } = await entityQuery(table, "delete", null, { id, ...params })

    if (error) {
        console.error(error)
        return { error }
    }

    const entity = data[0]

    await sendRealtime(table, 'delete_entity', entity)

    return { entity }
}

/**
 * Delete entities from a SQL table
 * @param {string} table SQL table to delete entity from
 * @param {object} [params={}] Parameters to apply to the delete query
 * @returns {Promise<{entities?: object[], error?: PostgrestError}>} Success status or error
 */
export async function deleteEntities(table, params = {}) {
    const { data: entities, error } = await entityQuery(table, "delete", null, params)

    if (error) {
        console.error(error)
        return { error }
    }

    await Promise.all(entities.map(async entity => {
        await sendRealtime(table, 'update_entity', entity)
    }))

    return { entities }
}


/**
 * Build a query for a SQL table
 * @param {string} table SQL table to build query for
 * @param {string} method Method to use for the query
 * @param {object} values Values to use in the query
 * @param {object} params Parameters to apply to the query
 * @param {string[]} select Fields to select
 * @returns {PostgrestFilterBuilder} Query for the SQL table
 */
export async function entityQuery(table, method, values, params, select) {
    delete params?.lang
    const entitySchemas = await loadEntitySchemas()
    const supabase = createAdminClient()

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
        query = supabase.from(table).upsert(values, { ignoreDuplicates: !!entitySchema.ignoreDuplicates, onConflict: entitySchema.onConflict })
    }

    if (!query) return { error: 'Method not allowed' }

    // Select values with default fallback
    const selectValues = (select || entitySchema.select)?.join(', ')
    query = query.select(selectValues, { count: 'exact' })

    // Sort order
    const order = params.order || entitySchema.defaultOrder

    if (order) {
        const orderParams = order.split(',')
        orderParams.forEach(param => {
            const isDesc = param.startsWith('-')
            const field = isDesc ? param.slice(1) : param
            query = query.order(field, { ascending: !isDesc })
        })
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
        for (let [key, value] of Object.entries(params)) {
            if (['limit', 'offset', 'order'].includes(key)) continue

            if (key == 'or') {
                query = query.or(value)
            } else if (key.endsWith('_neq')) {
                query = query.neq(key.slice(0, -4), value)
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
            } else if (value == "null" || value == null) {
                query = query.is(key, null)
            } else {
                query = query.eq(key, value)
            }
        }
    }

    return query
}