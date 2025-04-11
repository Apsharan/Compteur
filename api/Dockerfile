# Use the official Node.js image
FROM node:18

# Create and set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application files
COPY . .

# Expose the API port
EXPOSE 3000

# Run the API server
CMD ["node", "server.js"]
