# Architecture

## Component overview

```mermaid
flowchart LR
    Client[Client / Postman]

    Gateway[API Gateway :3000]
    User[User Service :4001]
    Notification[Notification Service :4002]
    NATS[(NATS JetStream<br/>stream: USER_EVENTS<br/>subjects: users.*)]
    UserDB[(User MongoDB)]
    NotificationDB[(Notification MongoDB)]

    Client -->|HTTP| Gateway

    Gateway -->|HTTP /users/*| User
    Gateway -->|HTTP /notifications/*| Notification

    User --> UserDB
    Notification --> NotificationDB

    User -->|publish users.created / users.updated| NATS
    NATS -->|durable pull consumer<br/>notification-service-user-events| Notification
```

**Rule enforced throughout the codebase:** User Service and Notification Service never call each other over REST or WebSockets. The only channel between them is the JetStream stream. The gateway is the sole HTTP client of both services.

## Registration sequence

```mermaid
sequenceDiagram
    actor C as Client
    participant G as API Gateway
    participant U as User Service
    participant UDB as User MongoDB
    participant JS as NATS JetStream
    participant N as Notification Service
    participant NDB as Notification MongoDB

    C->>G: POST /api/auth/register
    G->>U: POST /users/register (proxy)
    U->>UDB: insert user (bcrypt hash)
    U->>JS: publish users.created (await PubAck, msgID=eventId)
    U-->>G: 201 { user, token }
    G-->>C: 201 { user, token }

    JS-->>N: deliver message (durable pull consumer)
    N->>N: validate envelope + payload
    N->>N: ledger check eventId (idempotency)
    alt new event
        N->>NDB: insert WELCOME notification
        N->>NDB: insert processedEvent(eventId)
        N->>JS: ACK
    else duplicate
        N->>JS: ACK (no second notification)
    end
```

## Event processing state machine

```mermaid
stateDiagram-v2
    [*] --> Received
    Received --> Invalid: JSON/envelope/payload bad
    Invalid --> DeadLettered: term() + copy to events.deadletter
    Received --> Duplicate: eventId in ledger
    Duplicate --> Acked
    Received --> Processing: handler runs
    Processing --> Failed: exception
    Failed --> Received: nak(2s) -> redelivery (deliveryCount < maxDeliver)
    Failed --> DeadLettered: deliveryCount >= maxDeliver
    Processing --> LedgerWrite: notification saved
    LedgerWrite --> Acked: ledger row created
    LedgerWrite --> Failed: ledger write error (nak, will retry)
    Acked --> [*]
```

## Data ownership

| Store | Owner | Contents |
|---|---|---|
| `users` DB | User Service | users (name, email, bcrypt hash, isActive, timestamps) |
| `notifications` DB | Notification Service | notifications (userId, type, message, status) + processedevents ledger |
| JetStream `USER_EVENTS` | shared bus | user lifecycle events, file-backed, 7-day retention |

No service reads another service's database. Cross-service data flows only through events.

## Ports and exposure

| Component | Port | Exposure |
|---|---|---|
| API Gateway | 3000 | published to host (only public port) |
| User Service | 4001 | internal network only |
| Notification Service | 4002 | internal network only |
| NATS client | 4222 | internal network only (auth required) |
| NATS monitoring | 8222 | internal network only |
| MongoDB ×2 | 27017 | internal network only |
