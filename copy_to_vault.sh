#!/bin/bash

# usage: ./copy_to_vault.sh /path/to/your/vault
vault=$1

# check if path exists
if [ ! -d "$vault" ]; then
    echo "Usage: ./copy_to_vault.sh /path/to/your/vault"
    exit 1
fi

plugin_path="$1/.obsidian/plugins/samind-3d-graph"

# create plugin directory if it does not exist

if [ ! -d "$plugin_path" ]; then
    echo "Creating plugin directory in $vault"
    mkdir -p "$plugin_path"
fi

# remove all files inside of the directory
echo "Removing old plugin files in $vault"
rm -rf "${plugin_path:?}"/*


echo "Copying new plugin files to $vault"
cp ./manifest.json "$plugin_path"
cp ./styles.css "$plugin_path"
cp ./main.js "$plugin_path"
touch "$plugin_path"/.hotreload

echo "Done"