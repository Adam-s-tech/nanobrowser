#!/bin/bash
# Usage: ./update_version.sh <new_version>
# FORMAT IS <0.0.0>

if [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  # Only the root package.json has a version; WXT uses it as the manifest version.
  package_json="$(dirname "$0")/package.json"
  perl -i -pe 's/^(  "version": ")[^"]*/${1}'"$1"'/' "$package_json"

  echo "Updated versions to $1";
else
  echo "Version format <$1> isn't correct, proper format is <0.0.0>";
  exit 1
fi
