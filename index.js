// Load environment variables
require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");

const app = express();
const port = 3000;
const token = process.env.SLACK_TOKEN;

// Initialize Slack WebClient
const slack = new WebClient(token);

// Middleware to parse JSON
app.use(express.json());

// Cache variable to store user information
const userCache = new Map();

// Cache for team info
let teamInfo = null;

// Function to get team info
async function getTeamInfo() {
  if (teamInfo) return teamInfo;

  try {
    const result = await slack.auth.test();
    teamInfo = {
      id: result.team_id,
      domain: result.team_domain || result.team, // team_domain is the workspace name
    };
    return teamInfo;
  } catch (error) {
    console.error("Error fetching team info:", error);
    return null;
  }
}

// Route to get the list of users in a channel
app.get("/users/:channelId", async (req, res) => {
  const { channelId } = req.params;

  try {
    // Retrieve the list of members in the channel
    const membersResult = await slack.conversations.members({
      channel: channelId,
    });

    const memberIds = membersResult.members || [];

    // Retrieve detailed information for each user
    const users = await Promise.all(
      memberIds.map(async (userId) => {
        try {
          const userResult = await slack.users.info({
            user: userId,
          });
          const user = userResult.user;
          const userInfo = {
            id: user.id,
            name: user.name,
            real_name: user.real_name,
            display_name: user.profile.display_name || user.real_name,
            email: user.profile.email || null,
            avatar: user.profile.image_192 || null,
            is_bot: user.is_bot,
            is_admin: user.is_admin || false,
            team_id: user.team_id,
          };

          // Save user to cache
          userCache.set(user.id, userInfo);

          return userInfo;
        } catch (error) {
          console.error(`Error fetching info for user ${userId}:`, error);
          return null;
        }
      })
    );

    // Filter out null users (in case of errors)
    const validUsers = users.filter((user) => user !== null);

    res.json({
      success: true,
      channel: channelId,
      users: validUsers,
      total: validUsers.length,
    });
  } catch (error) {
    console.error("Error fetching channel members:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      slack_error_code: error.data?.error || null,
    });
  }
});

// Helper function to fetch thread replies
async function fetchThreadReplies(channelId, threadTs) {
  try {
    const result = await slack.conversations.replies({
      channel: channelId,
      ts: threadTs,
    });

    // Get team info for message links
    const team = await getTeamInfo();
    const workspaceName = team?.domain || "";

    // Process each message in the thread
    const replies = [];

    for (const msg of result.messages) {
      // Get user info from cache or fetch it
      let userInfo = userCache.get(msg.user);

      // If user info is not in cache, fetch it from Slack API
      if (!userInfo && msg.user) {
        try {
          const userResult = await slack.users.info({ user: msg.user });
          if (userResult.ok) {
            const user = userResult.user;
            userInfo = {
              id: user.id,
              name: user.name,
              real_name: user.real_name,
              display_name: user.profile.display_name || user.real_name,
              email: user.profile.email || null,
              avatar: user.profile.image_192 || null,
              is_bot: user.is_bot,
              is_admin: user.is_admin || false,
              team_id: user.team_id,
            };
            // Update the cache
            userCache.set(user.id, userInfo);
          }
        } catch (error) {
          console.error(`Error fetching info for user ${msg.user}:`, error);
        }
      }

      // If still no user info, use fallback
      if (!userInfo) {
        userInfo = {
          id: msg.user,
          name: "Unknown",
          real_name: "Unknown",
          display_name: "Unknown",
          email: null,
          avatar: null,
          is_bot: false,
          is_admin: false,
          team_id: null,
        };
      }

      // Format timestamp to hh:mm:ss
      const date = new Date(parseFloat(msg.ts) * 1000);
      const timeFormatted = date.toTimeString().split(" ")[0]; // Gets hh:mm:ss

      // Convert timestamp to Slack message ID format
      const messageId = msg.ts.replace(".", "");
      const slackLink = `https://${workspaceName}.slack.com/archives/${channelId}/p${messageId}`;

      // Only add the reply if it's not the parent message (first message in thread)
      if (msg.ts !== threadTs) {
        replies.push({
          user_name:
            userInfo.display_name || userInfo.real_name || userInfo.name,
          time: timeFormatted,
          content: msg.text,
          slack_link: slackLink,
        });
      }
    }

    return replies;
  } catch (error) {
    console.error(`Error fetching thread replies for ${threadTs}:`, error);
    return [];
  }
}

// Route to crawl messages from a channel
app.get("/crawl/:channelId", async (req, res) => {
  const { channelId } = req.params;
  const { limit, oldest, latest, inclusive, cursor } = req.query;

  try {
    // Get team info for message links
    const team = await getTeamInfo();
    const workspaceName = team?.domain || "";

    // Call conversations.history API with filters
    const result = await slack.conversations.history({
      channel: channelId,
      limit: parseInt(limit) || 100,
      oldest: oldest || undefined,
      latest: latest || undefined,
      inclusive: inclusive === "true",
      cursor: cursor || undefined,
    });

    // Process messages and fetch thread replies
    const messages = await Promise.all(
      result.messages.map(async (msg) => {
        // Get user info from cache or fetch it
        let userInfo = userCache.get(msg.user);

        // If user info is not in cache, fetch it from Slack API
        if (!userInfo && msg.user) {
          try {
            const userResult = await slack.users.info({ user: msg.user });
            if (userResult.ok) {
              const user = userResult.user;
              userInfo = {
                id: user.id,
                name: user.name,
                real_name: user.real_name,
                display_name: user.profile.display_name || user.real_name,
                email: user.profile.email || null,
                avatar: user.profile.image_192 || null,
                is_bot: user.is_bot,
                is_admin: user.is_admin || false,
                team_id: user.team_id,
              };
              // Update the cache
              userCache.set(user.id, userInfo);
            }
          } catch (error) {
            console.error(`Error fetching info for user ${msg.user}:`, error);
          }
        }

        // If still no user info, use fallback
        if (!userInfo) {
          userInfo = {
            id: msg.user,
            name: "Unknown",
            real_name: "Unknown",
            display_name: "Unknown",
            email: null,
            avatar: null,
            is_bot: false,
            is_admin: false,
            team_id: null,
          };
        }

        // Format timestamp to hh:mm:ss
        const date = new Date(parseFloat(msg.ts) * 1000);
        const timeFormatted = date.toTimeString().split(" ")[0]; // Gets hh:mm:ss

        // Convert timestamp to Slack message ID format
        const messageId = msg.ts.replace(".", "");
        const slackLink = `https://${workspaceName}.slack.com/archives/${channelId}/p${messageId}`;

        // Handle join messages
        let messageText = msg.text;
        if (msg.subtype === "channel_join") {
          messageText = `${
            userInfo.display_name || userInfo.real_name || userInfo.name
          } has joined the channel`;
        }

        // Format the message as a string
        let messageString = `${timeFormatted} | ${
          userInfo.display_name || userInfo.real_name || userInfo.name
        } | ${messageText}`;

        // If this message has thread replies, fetch them
        if (msg.reply_count > 0) {
          const replies = await fetchThreadReplies(channelId, msg.ts);
          // Format replies as strings
          const replyStrings = replies.map(
            (reply) => `  ${reply.time} | ${reply.user_name} | ${reply.content}`
          );
          messageString += "\n" + replyStrings.join("\n");
        }

        return messageString;
      })
    );

    // Return the array of message strings
    res.json(messages);
  } catch (error) {
    console.error("Error crawling messages:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});

// Route to get the list of channels
app.get("/channels", async (req, res) => {
  try {
    const result = await slack.conversations.list({
      types: "public_channel,private_channel",
    });

    const channels = result.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
    }));

    res.json({
      success: true,
      channels,
    });
  } catch (error) {
    console.error("Error fetching channels:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
