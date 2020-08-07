import path from 'path';
import { Auth0 } from 'auth0-source-control-extension-tools';
import { writeFileSync } from 'fs-extra';

import log from '../../logger';
import {
  toConfigFn,
  stripIdentifiers
} from '../../utils';
import handlers from './handlers';
import cleanAssets from '../../readonly';
import fromJSON from './formatter';

function formatTF(data) {
  return (Array.isArray(data) ? data : [ data ]).map(item => fromJSON(item)).join('\n');
}
export default class {
  constructor(config, mgmtClient) {
    this.filePath = config.AUTH0_INPUT_FILE;
    this.config = config;
    this.mappings = config.AUTH0_KEYWORD_REPLACE_MAPPINGS;
    this.mgmtClient = mgmtClient;

    // Get excluded rules
    this.assets = {
      exclude: {
        rules: config.AUTH0_EXCLUDED_RULES || [],
        clients: config.AUTH0_EXCLUDED_CLIENTS || [],
        databases: config.AUTH0_EXCLUDED_DATABASES || [],
        connections: config.AUTH0_EXCLUDED_CONNECTIONS || [],
        resourceServers: config.AUTH0_EXCLUDED_RESOURCE_SERVERS || [],
        defaults: config.AUTH0_EXCLUDED_DEFAULTS || []
      }
    };
  }

  async load() {
    log.info(`Processing terraform directory ${this.filePath}`);
    throw new Error('Import is not supported for the Terraform format. Please use terraform-provider-auth0.');
  }

  async dump(assets) {
    const auth0 = new Auth0(
      this.mgmtClient,
      this.assets,
      toConfigFn(this.config)
    );
    if (!assets) {
      log.info('Loading Auth0 Tenant Data');
      await auth0.loadAll();
      this.assets = auth0.assets;
    } else {
      this.assets = { ...assets, ...this.assets };
    }

    // Clean known read only fields
    this.assets = cleanAssets(this.assets, this.config);

    // Copy clients to be used by handlers which require converting client_id to the name
    // Must copy as the client_id will be stripped if AUTH0_EXPORT_IDENTIFIERS is false
    this.assets.clientsOrig = [ ...this.assets.clients ];

    // Optionally Strip identifiers
    if (!this.config.AUTH0_EXPORT_IDENTIFIERS) {
      this.assets = stripIdentifiers(auth0, this.assets);
    }
    writeFileSync(path.join(this.filePath, 'provider.tf'), `provider "auth0" {
  version = "> 0.8"
  domain  = "${this.config.AUTH0_DOMAIN}"
}`);
    await Promise.all(Object.entries(handlers).map(async ([ name, handler ]) => {
      try {
        const data = await handler.dump(this);
        if (data) {
          log.info(`Exporting ${name}`);
          writeFileSync(path.join(this.filePath, `${name}.tf`), formatTF(data));
        }
      } catch (err) {
        log.debug(err.stack);
        throw new Error(`Problem exporting ${name}`);
      }
    }));
  }
}
