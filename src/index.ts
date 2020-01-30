import S3 from 'aws-sdk/clients/s3'
import DynamoDB from 'aws-sdk/clients/dynamodb'
import fs from 'fs'
import {Observable, Subject} from 'rxjs'
import {} from 'rxjs/operators'
import {ajax} from "rxjs/ajax";
import {OAuth2Client, TokenInfo} from 'google-auth-library';
import http from 'http';
import url from 'url';
import open from 'open';
import enableDestroy from 'server-destroy';

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

const credentials = JSON.parse(fs.readFileSync('credentials.json').toString('utf8'));

function getAuthenticatedClient(scopes: string[]): Promise<OAuth2Client> {
    return new Promise((resolve, reject) => {
        const client = new OAuth2Client(
            credentials.web.client_id,
            credentials.web.client_secret,
            credentials.web.redirect_uris[0]
        );

        // try to read existing credentials from tokens.json
        try {
            client.setCredentials(JSON.parse(fs.readFileSync('tokens.json').toString('utf8')));

            resolve(client);
            return;
        } catch (err) {
            // ignore
        }

        // get credentials
        const authorizeUrl = client
            .generateAuthUrl({ 'access_type': 'offline', scope: scopes });

        const server = http.createServer((req, res) => {
            try {
                if (req.url.includes('/sso')) {
                    const code = new url.URL(req.url, 'http://localhost:8888').searchParams.get('code');

                    res.end('Authentication successful! Please return to the console.');

                    server.destroy();

                    client.getToken(code)
                        .then((tokenResponse) => {
                            fs.writeFileSync('tokens.json', JSON.stringify(tokenResponse.tokens));

                            client.setCredentials(tokenResponse.tokens);
                            resolve(client);
                        })
                        .catch((err) => reject(err));
                }
            } catch (e) {
                reject(e);
            }
        })
        .listen(8888, () => {
            open(authorizeUrl, {wait: false}).then(cp => cp.unref());
        });

        enableDestroy(server);
    });
}

function main(): Observable<object> {
    const pages$ = new Subject<{}>();

    getAuthenticatedClient(SCOPES).then((client) => {

        const getMediaItems = (client: OAuth2Client, pageToken?: string): void => {
            let url = 'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100';
            if (pageToken) {
                url += `&pageToken=${pageToken}`;
            }

            console.log(url);

            client.request<object>({url})
                .then((resp) => {
                    pages$.next(resp.data);
                    getMediaItems(client, resp.data['nextPageToken']);
                });
        };

        getMediaItems(client);
    });

    return pages$;
}

main().subscribe({ next: (page) => {
    console.log(page['mediaItems'].length);
}, error: (err) => { console.error(err); }});
