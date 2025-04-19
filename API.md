# Slack Crawler API Documentation

## Base URL

```
http://localhost:3000
```

## Authentication

All endpoints require a Slack token passed as a query parameter:

```
?token=<your_slack_token>
```

## API Contract

### 1. Get List of Channels

Retrieves all available channels in the workspace.

#### Request

```http
GET /channels?token={slack_token}
```

#### Query Parameters

| Parameter | Type   | Required | Description     |
| --------- | ------ | -------- | --------------- |
| token     | string | Yes      | Slack API token |

#### Response

**Status Code:** 200 OK

```typescript
interface Channel {
  id: string; // Channel ID (e.g., "C123456")
  name: string; // Channel name (e.g., "general")
}

type Response = Channel[];
```

**Example Response:**

```json
[
  {
    "id": "C123456",
    "name": "general"
  },
  {
    "id": "C789012",
    "name": "random"
  }
]
```

#### Error Responses

| Status Code | Response Body                            | Description             |
| ----------- | ---------------------------------------- | ----------------------- |
| 400         | `{ "error": "Slack token is required" }` | Missing token parameter |
| 500         | `{ "error": "Error message" }`           | Server/Slack API error  |

### 2. Crawl Messages from Channels

Retrieves messages from one or more channels.

#### Request

```http
GET /crawl?token={slack_token}&channels={channel_ids}&[limit={number}]&[oldest={timestamp}]&[latest={timestamp}]&[inclusive={boolean}]&[cursor={string}]
```

#### Query Parameters

| Parameter | Type    | Required | Default | Description                                     |
| --------- | ------- | -------- | ------- | ----------------------------------------------- |
| token     | string  | Yes      | -       | Slack API token                                 |
| channels  | string  | Yes      | -       | Comma-separated channel IDs (e.g., "C123,C456") |
| limit     | number  | No       | 100     | Messages per channel                            |
| oldest    | number  | No       | -       | Start time (Unix timestamp)                     |
| latest    | number  | No       | -       | End time (Unix timestamp)                       |
| inclusive | boolean | No       | false   | Include messages at exact timestamp             |
| cursor    | string  | No       | -       | Pagination cursor                               |

#### Response

**Status Code:** 200 OK

```typescript
interface Message {
  time: string; // HH:MM:SS format
  username: string; // Display name of user
  content: string; // Message content
}

interface Reply extends Message {
  isReply: true; // Indicates this is a reply
}

type ChannelMessages = (Message | Reply)[];

interface Response {
  [channelId: string]: ChannelMessages;
}
```

**Example Response:**

```json
{
  "C123456": [
    "10:30:15 | John Doe | Message from channel 1 | https://your-workspace.slack.com/archives/C123456/p1234567890",
    "10:32:45 | Bob Wilson | Message from channel 1 | https://your-workspace.slack.com/archives/C123456/p1234567891",
    "        | 10:33:00 | Alice Brown | Reply to Bob's message | https://your-workspace.slack.com/archives/C123456/p1234567892"
  ],
  "C789012": [
    "10:31:20 | Jane Smith | Message from channel 2 | https://your-workspace.slack.com/archives/C789012/p1234567893",
    "10:34:00 | Mike Johnson | Another message from channel 2 | https://your-workspace.slack.com/archives/C789012/p1234567894"
  ]
}
```

#### Error Responses

| Status Code | Response Body                             | Description                |
| ----------- | ----------------------------------------- | -------------------------- |
| 400         | `{ "error": "Slack token is required" }`  | Missing token parameter    |
| 400         | `{ "error": "Channel IDs are required" }` | Missing channels parameter |
| 500         | `{ "error": "Error message" }`            | Server/Slack API error     |

## Message Format Specification

### Root Messages

```
[ChannelID] HH:MM:SS | Username | Message Content | Message Link
```

### Thread Replies

```
        | HH:MM:SS | Username | Reply Content | Message Link
```

### Message Link Format

The message link follows this format:

```
https://{workspace}.slack.com/archives/{channel_id}/p{timestamp}
```

Where:

- `{workspace}` is your Slack workspace domain
- `{channel_id}` is the channel ID
- `{timestamp}` is the message timestamp in Slack's format

Example:

```
[C123456] 10:30:15 | John Doe | Hello everyone | https://your-workspace.slack.com/archives/C123456/p1234567890
        | 10:31:00 | Jane Smith | Hi there | https://your-workspace.slack.com/archives/C123456/p1234567891
```

## Rate Limiting

The API adheres to Slack's rate limits:

- Tier 3: 50+ requests per minute
- Tier 2: 20+ requests per minute
- Tier 1: 1+ requests per minute

Refer to [Slack's API documentation](https://api.slack.com/docs/rate-limits) for detailed rate limit information.

## Notes

- All timestamps are in 24-hour format (HH:MM:SS)
- Channel IDs are prefixed with 'C'
- Private channels require appropriate permissions
- Messages are sorted chronologically within each channel
- Thread replies are indented with 8 spaces
- The API supports both public and private channels
- All timestamps are in the server's local timezone
