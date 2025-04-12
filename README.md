# Simple Chat Slack Integration

This project is a simple Slack integration that allows you to interact with Slack channels, users, and messages.

## Setup Guide

### Step 1: Create a Slack App

1. Go to [Slack API Apps](https://api.slack.com/apps).
2. Click **Create New App** and select **From Scratch**.
3. Enter an app name and select your workspace.

### Step 2: Configure OAuth & Permissions

1. Navigate to **OAuth & Permissions** in the Slack app settings.
2. Under **Scopes**, add the following bot token scopes:
   - `channels:history`
   - `channels:manage`
   - `channels:read`
   - `groups:read`
   - `incoming-webhook`
   - `users.profile:read`
   - `users:read`
   - `users:read.email`
3. Install the app to your workspace and copy the generated **OAuth Token**.

### Step 3: Configure Event Subscriptions

1. Navigate to **Event Subscriptions** in the Slack app settings.
2. Enable **Event Subscriptions**.
3. Set the **Request URL** to `http://<your-server-url>/slack/events`.
4. Under **Subscribe to Bot Events**, add the following events:
   - `member_joined_channel`
   - `message.channels`
   - `user_change`
5. Save the changes.

### Step 4: Run the Application

1. Clone this repository and navigate to the project directory.
2. Install dependencies:
   ```bash
   npm install
   ```
