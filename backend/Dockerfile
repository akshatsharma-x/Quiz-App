FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies exclusively
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Clean exact install (excellent for CI/CD and Docker environments)
RUN npm ci

# Bundle app source
COPY . .

# Expose the defined port
EXPOSE 3000

# Start command (using node instead of nodemon for production stability)
CMD [ "node", "src/server.js" ]
