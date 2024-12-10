import { createEntity, getEntity, loadEntitySchema } from "./entity-helpers.js"

/**
 * Safely retrieves a nested value from an object given a path string like 'article.user_id'.
 * @param {object} obj - The object to retrieve a value from.
 * @param {string} path - The path string, e.g., 'article.user_id'.
 */
function getNestedValue(obj: Record<string, any>, path: string): any {
    return path?.split('.').reduce((acc, key) => acc && acc[key], obj)
}

/**
 * Replaces placeholders in the form of {{variable}} with corresponding values from entity.
 * @param {string} template - The string template with placeholders.
 * @param {object} entity - An object containing key-value pairs to replace placeholders.
 */
function replaceBrackets(template: string, entity: Record<string, any>) {
    return template?.replace(/{{(\w+(\.\w+)*)}}/g, (match, key) => {
        return getNestedValue(entity, key) || match
    })
}

export async function createNotification(table: string, method: string, entity: Record<string, any>) {
    const { entitySchema: { notifications, notificationTemplate } } = await loadEntitySchema(table)
    if (!notifications) return

    // Use template fields and entity to construct notification JSON
    const notification = {
        user_id: getNestedValue(entity, notificationTemplate.userIdColumn),
        sender_id: getNestedValue(entity, notificationTemplate.senderIdColumn),
        content: {
            en: replaceBrackets(notificationTemplate.content.en, entity),
        },
        image_url: getNestedValue(entity, notificationTemplate.imageUrlColumn),
        url: replaceBrackets(notificationTemplate.url, entity),
        url_as: replaceBrackets(notificationTemplate.urlAs, entity),
        primary_label: notificationTemplate.primaryLabel && {
            en: replaceBrackets(notificationTemplate.primaryLabel.en, entity)
        },
        primary_action: notificationTemplate.primaryAction && {
            ...notificationTemplate.primaryAction,
            url: replaceBrackets(notificationTemplate.primaryAction.url, entity),
            urlAs: replaceBrackets(notificationTemplate.primaryAction.urlAs, entity),
        },
        secondary_label: notificationTemplate.secondaryLabel && {
            en: replaceBrackets(notificationTemplate.secondaryLabel.en, entity)
        },
        secondary_action: notificationTemplate.secondaryAction && {
            ...notificationTemplate.secondaryAction,
            url: replaceBrackets(notificationTemplate.secondaryAction.url, entity),
            urlAs: replaceBrackets(notificationTemplate.secondaryAction.urlAs, entity),
        },
    }

    // Check the user metadata to see if notifications are enabled
    const { entity: metadata } = await getEntity('metadata', notification.user_id)
    if (!metadata?.notifications_enabled) return

    await createEntity('notifications', notification)
}