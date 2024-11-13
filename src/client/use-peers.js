import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import Peer, { DataConnection } from "peerjs"
import { useEntities } from "@daveyplate/supabase-swr-entities/client"
import { v4 } from "uuid"

/**
 * Peer Connections hook
 * @param {Object} props - The hook props
 * @param {boolean} [props.enabled=true] - Is the hook enabled
 * @param {(data: any, connection: DataConnection, peer: Peer) => void} [props.onData=null] - The data handler
 * @param {string} [props.room=null] - The room to connect to
 * @param {string[]} [props.allowedUsers=["*"]] - The users allowed to send data to
 * @returns {{ peers: any[], sendData: (data: any, connections: DataConnection[]?) => void, connections: DataConnection[], isOnline: (userId: string) => boolean, getPeer: (connection: DataConnection) => any, getConnection: (userId: string) => DataConnection}} The hook result
 */
export function usePeers({ enabled = true, onData = null, room = null, allowedUsers = ["*"] }) {
    const [_, forceUpdate] = useReducer(x => x + 1, 0)

    const {
        entities: peers,
        createEntity: createPeer,
        updateEntity: updatePeer,
        deleteEntity: deletePeer,
        mutateEntities: mutatePeers,
    } = useEntities(enabled && 'peers', { room })

    const [peer, setPeer] = useState(null)
    const connectionsRef = useRef([])
    const connectionAttempts = useRef([])
    const [dataQueue, setDataQueue] = useState([])
    const messageHistory = useRef([])

    // Data queue handler
    useEffect(() => {
        if (!peers) return

        const newDataQueue = []

        dataQueue.forEach(({ data, connection }) => {
            const peer = getPeer(connection)
            if (!peer) return newDataQueue.push({ data, connection })

            if (!allowedUsers.includes("*") && !allowedUsers.includes(peer.user_id)) {
                console.error("Unauthorized data from: ", peer, connection)
                return connection.close()
            }

            onData(data, connection, peer)
        })

        if (newDataQueue.length != dataQueue.length) {
            setDataQueue(newDataQueue)
        }
    }, [peers, dataQueue, JSON.stringify(allowedUsers)])

    /**
     * Prepare connection handlers
     * @param {DataConnection} connection - The connection
     * @param {boolean} [inbound=false] - Is the connection inbound
     */
    const handleConnection = (connection, inbound = false) => {
        connection?.removeAllListeners()

        onData && connection?.on("data", (data) => {
            setDataQueue((prevQueue) => [...prevQueue, { data, connection }])
        })

        connection?.on("open", () => {
            console.log("connection opened", room)
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionsRef.current.push(connection)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()

            // Refresh the peers on new inbound connections
            inbound && mutatePeers()

            sendMessageHistory(connection)
        })

        connection?.on('close', () => {
            console.log("connection closed")
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()
        })

        connection?.on('error', (error) => {
            console.error("connection error", error)
            connectionsRef.current = connectionsRef.current.filter((conn) => conn.peer != connection.peer)
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
            forceUpdate()
        })

        // 10 second timeout for connection attempts
        setTimeout(() => {
            connectionAttempts.current = connectionAttempts.current.filter((id) => id != connection.peer)
        }, 10000)
    }

    // Clean up the peer on unmount
    useEffect(() => {
        if (!enabled || !room || !peer) return

        const deletePeerOnUnload = () => {
            peer?.id && deletePeer(peer.id)
            connectionsRef.current.forEach((conn) => conn.close())
            connectionsRef.current = []
            connectionAttempts.current = []
            setDataQueue([])
            messageHistory.current = []
            peer?.destroy()
        }

        window.addEventListener("beforeunload", deletePeerOnUnload)

        return () => {
            deletePeerOnUnload()
            window.removeEventListener("beforeunload", deletePeerOnUnload)
        }
    }, [enabled, room, peer])

    useEffect(() => {
        if (!enabled || !room) return

        // Create a new Peer instance
        const newPeer = new Peer(v4())
        newPeer.on('open', (id) => {
            console.log('Peer ID', id, 'Room', room)
            setPeer(newPeer)
        })

        // newPeer.on('error', console.error)

        return () => {
            newPeer.removeAllListeners()
            newPeer.on('open', () => newPeer.destroy())
        }
    }, [enabled, room])

    useEffect(() => {
        if (!peer?.id || !peers || !enabled) return

        const keepPeerCurrent = () => {
            const currentPeer = peers.find((p) => p.id == peer.id)
            if (currentPeer) {
                updatePeer(currentPeer, { updated_at: new Date() })
            } else {
                createPeer({ id: peer.id, room })
            }
        }

        const interval = setInterval(keepPeerCurrent, 60000)

        if (!peers.find(p => p.id == peer.id)) {
            createPeer({ id: peer.id, room })
        }

        const inboundConnection = (conn) => {
            handleConnection(conn, true)
        }

        peer.on("connection", inboundConnection)

        peers.forEach(p => {
            if (p.id == peer.id) return
            if (connectionsRef.current.some((c) => c.peer == p.id)) return
            if (connectionAttempts.current.includes(p.id)) return
            if (allowedUsers.includes("*") || allowedUsers.includes(p?.user_id)) {
                connectionAttempts.current.push(p.id)
                const conn = peer.connect(p.id)
                handleConnection(conn)
            }
        })

        connectionsRef.current.forEach((conn) => {
            handleConnection(conn)
        })

        return () => {
            clearInterval(interval)
            peer.off("connection", inboundConnection)
        }
    }, [peers, peer, onData, connectionsRef.current, JSON.stringify(allowedUsers)])

    /**
     * Send data to all connections
     * @param {any} data - The data to send
     * @param {DataConnection[]} [connections] - Limit the connections to send to
     */
    const sendData = useCallback((data, connections = null) => {
        messageHistory.current.push(data)
        setTimeout(() => {
            messageHistory.current = messageHistory.current.filter((d) => d != data)
        }, 10000)

            (connections || connectionsRef.current).forEach((connection) => {
                const peer = getPeer(connection)

                if (allowedUsers.includes("*") || allowedUsers.includes(peer?.user_id)) {
                    connection.send(data)
                }
            })
    }, [peers, connectionsRef.current, JSON.stringify(allowedUsers)])


    /**
     * Get the peer for a connection
     * @param {DataConnection} connection - The connection
     * @returns {any} The peer
     */
    const getPeer = useCallback((connection) => {
        return peers?.find((peer) => peer.id == connection?.peer)
    }, [peers, connectionsRef.current])

    const sendMessageHistory = useCallback((connection) => {
        const peer = getPeer(connection)
        if (allowedUsers.includes("*") || allowedUsers.includes(peer?.user_id)) {
            messageHistory.current.forEach(data => {
                console.log("sending message history", data)
                connection.send(data)
            })
        }
    }, [JSON.stringify(allowedUsers), getPeer])

    /**
     * Get the connection for a user
     * @param {string} userId - The user ID
     * @returns {DataConnection} The connection
     */
    const getConnection = useCallback((userId) => {
        return connectionsRef.current.find((connection) => {
            const connectionPeer = getPeer(connection)
            return connectionPeer?.user_id == userId
        })
    }, [peers, connectionsRef.current])

    /** 
     * Check if a user is online
     * @param {string} userId - The user ID
     * @returns {boolean} Is the user online
     */
    const isOnline = useCallback((userId) => !!getConnection(userId), [getConnection])

    return { peers, sendData, connections: connectionsRef.current, isOnline, getPeer, getConnection }
}