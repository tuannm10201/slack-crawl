// Load environment variables
require("dotenv").config();
const express = require("express");
const { WebClient } = require("@slack/web-api");

const app = express();
const port = 3000;

// Middleware to parse JSON
app.use(express.json());

// Cache variable to store user information
const userCache = new Map();

// Cache for team info
let teamInfo = null;

// Function to get team info
async function getTeamInfo(slack) {
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

// Helper function to format timestamp
function formatTimestamp(timestamp) {
  const date = new Date(parseFloat(timestamp) * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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

// Helper function to generate message link
function generateMessageLink(teamDomain, channelId, timestamp) {
  // Convert Slack timestamp to the format used in URLs
  const urlTimestamp = timestamp.replace(".", "");
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${urlTimestamp}`;
}

// Route to crawl messages from channels
app.get("/crawl", async (req, res) => {
  const { channels, limit, oldest, latest, inclusive, cursor, token } =
    req.query;

  if (!token) {
    return res.status(400).json({
      error: "Slack token is required",
    });
  }

  if (!channels) {
    return res.status(400).json({
      error:
        "Channel IDs are required. Use comma-separated values for multiple channels",
    });
  }

  try {
    // Initialize Slack WebClient with token from query parameter
    const slack = new WebClient(token);

    // Get team info for message links
    const teamInfo = await getTeamInfo(slack);
    if (!teamInfo) {
      return res.status(500).json({
        error: "Failed to get team information",
      });
    }

    // Split channels string into array
    const channelIds = channels.split(",");

    // Fetch messages from all channels in parallel
    const channelPromises = channelIds.map(async (channelId) => {
      try {
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
                console.error(
                  `Error fetching info for user ${msg.user}:`,
                  error
                );
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

            // Format timestamp with date
            const timeFormatted = formatTimestamp(msg.ts);

            // Generate message link
            const messageLink = generateMessageLink(
              teamInfo.domain,
              channelId,
              msg.ts
            );

            // Handle join messages
            let messageText = msg.text;
            if (msg.subtype === "channel_join") {
              messageText = `${
                userInfo.display_name || userInfo.real_name || userInfo.name
              } has joined the channel`;
            }

            // Format the message as a string with channel name and link
            let messageString = `${timeFormatted} | ${
              userInfo.display_name || userInfo.real_name || userInfo.name
            } | ${messageText} | ${messageLink}`;

            // If this message has thread replies, fetch them
            if (msg.reply_count > 0) {
              const replies = await fetchThreadReplies(
                channelId,
                msg.ts,
                slack
              );
              // Format replies as strings, aligned with root message's time
              const replyStrings = replies.map((reply) => {
                const replyLink = generateMessageLink(
                  teamInfo.domain,
                  channelId,
                  reply.ts
                );
                return `        | ${formatTimestamp(reply.ts)} | ${
                  reply.user_name
                } | ${reply.content} | ${replyLink}`;
              });
              messageString += "\n" + replyStrings.join("\n");
            }

            return messageString;
          })
        );

        return {
          channelId,
          messages,
        };
      } catch (error) {
        console.error(`Error crawling channel ${channelId}:`, error);
        return {
          channelId,
          error: error.message,
          messages: [],
        };
      }
    });

    // Wait for all channels to complete
    const results = await Promise.all(channelPromises);

    // Group messages by channel
    const groupedMessages = results.reduce((acc, result) => {
      acc[result.channelId] = result.messages;
      return acc;
    }, {});

    // Return messages grouped by channel
    res.json(groupedMessages);
  } catch (error) {
    console.error("Error crawling messages:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});

// Update fetchThreadReplies function to include message links
async function fetchThreadReplies(channelId, threadTs, slack) {
  try {
    const result = await slack.conversations.replies({
      channel: channelId,
      ts: threadTs,
    });

    // Process each message in the thread
    const replies = [];

    for (const msg of result.messages) {
      // Skip the parent message
      if (msg.ts === threadTs) continue;

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

      replies.push({
        ts: msg.ts,
        user_name: userInfo.display_name || userInfo.real_name || userInfo.name,
        time: timeFormatted,
        content: msg.text,
      });
    }

    return replies;
  } catch (error) {
    console.error(`Error fetching thread replies for ${threadTs}:`, error);
    return [];
  }
}

// Route to get the list of channels
app.get("/channels", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({
      error: "Slack token is required",
    });
  }

  try {
    // Initialize Slack WebClient with token from query parameter
    const slack = new WebClient(token);

    const result = await slack.conversations.list({
      types: "public_channel,private_channel",
    });

    const channels = result.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
    }));

    res.json(channels);
  } catch (error) {
    console.error("Error fetching channels:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});

// Route to get all users
app.get("/users", async (req, res) => {
  const { token, email, name } = req.query;

  if (!token) {
    return res.status(400).json({
      error: "Slack token is required",
    });
  }

  try {
    // Initialize Slack WebClient with token from query parameter
    const slack = new WebClient(token);

    // Get all users
    const result = await slack.users.list();
    if (!result.ok) {
      return res.status(500).json({
        error: "Failed to get users information",
      });
    }

    // Format user information
    let users = result.members.map((user) => ({
      id: user.id,
      name: user.name,
      real_name: user.real_name,
      display_name: user.profile.display_name || user.real_name,
      email: user.profile.email || null,
      avatar: user.profile.image_192 || null,
    }));

    // Filter by email if provided
    if (email) {
      users = users.filter(
        (user) =>
          user.email && user.email.toLowerCase().includes(email.toLowerCase())
      );
    }

    // Filter by name if provided
    if (name) {
      users = users.filter(
        (user) =>
          user.name.toLowerCase().includes(name.toLowerCase()) ||
          user.real_name.toLowerCase().includes(name.toLowerCase()) ||
          user.display_name.toLowerCase().includes(name.toLowerCase())
      );
    }

    res.json(users);
  } catch (error) {
    console.error("Error fetching users information:", error);
    res.status(500).json({
      error: error.message,
      slack_error_code: error.data?.error || null,
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
