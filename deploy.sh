#!/bin/bash
# deploy.sh — Deploy bc-reporter to GCP VM (velopulse-server)
# Usage: ./deploy.sh
#
# Prerequisites: gcloud CLI authenticated with velopulse-infra project

set -e

PROJECT="velopulse-infra"
ZONE="asia-east1-b"
VM="velopulse-server"
SERVICE="bc-reporter"
DEPLOY_DIR="/home/cph/deploy"

echo "🚀 Deploying $SERVICE to $VM..."

# 1. Pull latest code on VM
gcloud compute ssh $VM --project $PROJECT --zone $ZONE --command "
  cd $DEPLOY_DIR/$SERVICE && \
  git fetch origin && \
  git reset --hard origin/main && \
  echo '✅ Code updated to:' && \
  git log --oneline -1
"

# 2. Rebuild and restart container
gcloud compute ssh $VM --project $PROJECT --zone $ZONE --command "
  cd $DEPLOY_DIR && \
  docker compose up -d --build $SERVICE
"

# 3. Wait and verify health
sleep 5
STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://reports.velopulse.io/health)
if [ "$STATUS" = "200" ]; then
  echo "✅ Deploy successful — health check passed"
else
  echo "❌ Health check failed (HTTP $STATUS) — check logs:"
  echo "   gcloud compute ssh $VM --project $PROJECT --zone $ZONE --command 'docker logs deploy-${SERVICE}-1 --tail 30'"
  exit 1
fi
