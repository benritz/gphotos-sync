import S3 from 'aws-sdk/clients/s3'
import DynamoDB from 'aws-sdk/clients/dynamodb'
import fs from 'fs'
import {Observable, from, EMPTY} from 'rxjs'
import {expand, map, mergeMap, take} from 'rxjs/operators'
import {OAuth2Client} from 'google-auth-library';
import http from 'http';
import url from 'url';
import open from 'open';
import enableDestroy from 'server-destroy';

interface PhotoMetadata {
    cameraMake?: string;
    cameraModal?: string;
    focalLength?: number;
    apertureFNumber?: number;
    isoEquivalent?: number;
}

interface MediaMetadata {
    creationTime: string;
    width: string;
    height: string;
    photo?: PhotoMetadata;
}

interface MediaItem {
    id: string;
    productUrl: string;
    baseUrl: string;
    mimeType: string;
    mediaMetadata: MediaMetadata;
    filename: string;
}

interface MediaItemsResult {
    pageToken?: string;
    mediaItems: MediaItem[],
    nextPageToken?: string
}

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly'];

const credentials = JSON.parse(fs.readFileSync('credentials.json').toString('utf8'));

function getAuthenticatedClient(scopes: string[]): Observable<OAuth2Client> {
    return new Observable((subscriber) => {
        const client = new OAuth2Client(
            credentials.web.client_id,
            credentials.web.client_secret,
            credentials.web.redirect_uris[0]
        );

        // try to read existing credentials from tokens.json
        try {
            client.setCredentials(JSON.parse(fs.readFileSync('tokens.json').toString('utf8')));

            subscriber.next(client);
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
                            subscriber.next(client);
                        })
                        .catch((err) => subscriber.error(err));
                }
            } catch (e) {
                subscriber.error(e);
            }
        })
        .listen(8888, () => {
            open(authorizeUrl, {wait: false}).then(cp => cp.unref());
        });

        enableDestroy(server);
    });
}

function getMediaItems(): Observable<MediaItemsResult> {
    const getPage = (client: OAuth2Client, pageToken?: string): Observable<MediaItemsResult> => {
        let url = 'https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100';
        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        return from(client.request<MediaItemsResult>({url})).pipe(
            map((resp) => {
                const result = resp.data;

                if (pageToken) {
                    result.pageToken = pageToken;
                }

                return result;
            })
        );
    };

    return getAuthenticatedClient(SCOPES).pipe(
        mergeMap((client) =>
            getPage(client).pipe(
                expand((data) => data['nextPageToken'] ? getPage(client, data['nextPageToken']) : EMPTY)
            )
        )
    );
}

let total = 0;

getMediaItems().pipe(
    take(1)
).subscribe({ next: (result) => {
        result.mediaItems.forEach((mediaItem) => {
            console.log(mediaItem.productUrl);
            console.log(mediaItem.baseUrl);
        });
        // const count = page['mediaItems'].length;
        // total += count;
        // console.log(`${page['pageToken']} ${count}`);
        // console.log(`Total: ${total}`);
}, error: (err) => { console.error(err); }});


// https://photos.google.com/lr/photo/APznxHMWSBBPr4R6-aW-2Kgy2kcjguh8Yt_TaJAnzMXBlAauhuK5VIYn02LqaExTNoL65SzNQud3AUy1O4LPHSfAaINg6zNruQ
// https://lh3.googleusercontent.com/nhplhn6n2579Ed1wHeSWaRwxvZj-iIynNGJyqgSwVxyP-fswNjcsSf7bZJ1vh5PPy5oTqYvZA6D3hRJ8UH5cPn2PmRuvmXpQLynRAYPyrtA177uthVPQ9PRp0jLxzotAFqntf384aIlCXLF_udG793x0ywvNTC6kNIu_FYV_sJ6QT3msJ1AWw4SUnk7fuGPHvR4Pd0Y5K1lMVry2GLObQMnCF0KrObeRIvtm5d1bDOBxr10nxhF8hOaCIZkPW7pHYJoOKXXmzsp4Jzz29vF32sgLO1Qc7CkNSVui8IUEfEZJk4VtoK5bu2Uy3bNZIjQbUqFoo7HN9qRUAo21c9sOZTcoxBFFpL_dUNBfl_Px9H0-DN3JSe9UHeIyn8w7pJIvxav4yyrJPLB99ve5MGQaTc0QjgcXcoCLOq1-LCoDJeyJox7Sd-LLU3tiApWLy9sBQcCdGhSJ8618KFRoQt3T2KQvzQogfkJh_drv_Rnr4-6RIqURebNYkCm80-sqs95vWGv-QGnYs378K0il1HRM-IJgGtZEzcexHphlUxOt8ftqAQX4e3rFxK8FsX2MNYV72eMgQ3UMMTuubQq3XkzXuES_5Q3mQHQPmwTARsR01TSEYACkoK3tGYHFC-nTe-lKf05_Io_Wca3923MsQG5SDQ2VHd9GhEt_I4-wxC1gHbFX8nbhDHWju6O1jEdDI_cgLH3mT-diBQ