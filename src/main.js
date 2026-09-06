#!/usr/bin/env -S gjs -m

import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { BolasApplication } from './application.js';
import { APP_ID, APP_NAME } from './config.js';
import { configureSourceSettings } from './source-settings.js';

GLib.set_prgname(APP_ID);
GLib.set_application_name(APP_NAME);
configureSourceSettings({ appId: APP_ID, mainModuleUrl: import.meta.url });

const application = new BolasApplication();
const exitCode = application.run([System.programInvocationName, ...ARGV]);

System.exit(exitCode);
